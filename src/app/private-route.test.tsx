import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import type { AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SessionRole } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { SessionProvider } from '@/features/auth/model/session-provider';
import { TransferPage } from '@/features/transfer/pages/transfer-page';
import { PageHeading } from '@/shared/ui/page-heading';
import { createApiAdapter, errorReply, successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { AuthenticatedPage } from './layouts/authenticated-page';
import { ProtectedRouteError } from './layouts/protected-route-error';
import { SignedOutPage } from './layouts/signed-out-page';
import { privateRouteContext } from './private-route';
import type { AppRouterContext } from './router-context';
import { useSessionRouteInvalidation } from './use-session-route-invalidation';

const controllers: SessionController[] = [];
beforeEach(() => {
  // Use real React IDs instead of rc-util's shared test ID for nested dialogs.
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
});
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function TestRouter({ router }: { router: AnyRouter }) {
  useSessionRouteInvalidation(router);
  return <RouterProvider router={router} />;
}

function PrivateWallet() {
  return (
    <>
      {/* Guard tests use their own controlled loader; real wallet queries have separate coverage. */}
      <PageHeading title="My wallet" />
      <input aria-label="Private draft" />
    </>
  );
}

function renderPrivateApp(
  fixture: ReturnType<typeof createSessionFixture>,
  roles?: readonly SessionRole[],
  path: '/wallet' | '/transfer' = '/wallet',
) {
  controllers.push(fixture.controller);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRouteWithContext<AppRouterContext>()({ component: Outlet });
  const protectedRoute = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    beforeLoad: ({ context, abortController, preload }) =>
      privateRouteContext(context, {
        signal: abortController.signal,
        preload,
        roles,
      }),
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    pendingMs: 0,
    pendingMinMs: 0,
    component: AuthenticatedPage,
    errorComponent: ProtectedRouteError,
    pendingComponent: SignedOutPage,
  });
  const privateLoader = vi.fn();
  const wallet = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/wallet',
    loader: ({ context, abortController }) => {
      privateLoader();
      return context.api.request(
        { method: 'GET', path: '/api/v1/wallets/me', signal: abortController.signal },
        z.object({ value: z.number() }),
      );
    },
    component: PrivateWallet,
  });
  const transfer = createRoute({
    getParentRoute: () => protectedRoute,
    path: '/transfer',
    component: TransferPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([protectedRoute.addChildren([wallet, transfer])]),
    context: { queryClient, session: fixture.controller, privateApi: fixture.privateApi },
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPreload: false,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <SessionProvider controller={fixture.controller} privateApi={fixture.privateApi}>
          <TestRouter router={router} />
        </SessionProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { router, privateLoader };
}

describe('protected route and loader integration', () => {
  it('keeps a signed-out transfer URL private even during speculative preload', async () => {
    const fixture = createSessionFixture([], {
      initial: { version: 1, epoch: '10000000-0000-4000-8000-000000000001', mode: 'signed-out' },
    });
    const { router, privateLoader } = renderPrivateApp(fixture, undefined, '/transfer');
    await screen.findByRole('heading', { name: 'Sign in' });
    await act(() => router.preloadRoute({ to: '/transfer' }));
    expect(router.state.location.pathname).toBe('/transfer');
    expect(screen.queryByRole('heading', { name: 'Transfer' })).not.toBeInTheDocument();
    expect(privateLoader).not.toHaveBeenCalled();
    expect(fixture.adapter).not.toHaveBeenCalled();
  });

  it('opens transfer after login at the same URL and hides it on cross-tab sign out', async () => {
    const fixture = createSessionFixture(
      [
        csrfReply(),
        successReply(testSession),
        successReply({
          id: 7,
          userId: testSession.user.id,
          balance: 1000000,
          currency: 'VND',
          updatedAt: '2026-10-21T14:30:00.123456',
        }),
      ],
      {
        initial: { version: 1, epoch: '10000000-0000-4000-8000-000000000001', mode: 'signed-out' },
      },
    );
    const { router, privateLoader } = renderPrivateApp(fixture, undefined, '/transfer');
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText(/^Email address/), {
      target: { value: testSession.user.email },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Transfer' });
    await screen.findByLabelText('Available balance: 1,000,000 VND');
    expect(router.state.location.pathname).toBe('/transfer');
    expect(privateLoader).not.toHaveBeenCalled();
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
      '/api/v1/wallet/me',
    ]);
    expect(screen.queryByRole('button', { name: /Confirm transfer/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Recipient email/), {
      target: { value: 'recipient@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(/^Description/), {
      target: { value: 'private transfer draft' },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Review transfer' });

    const otherTab = fixture.hub.connect();
    await act(() =>
      otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' })),
    );
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('heading', { name: 'Transfer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review transfer' })).not.toBeInTheDocument();
    expect(screen.queryByText('private transfer draft')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/transfer');
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
  });

  it('hides the private page and draft before logout completes and preserves its URL', async () => {
    let release: () => void = () => undefined;
    let submitted = false;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      successReply({ value: 1 }),
      csrfReply(),
      successReply(),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/logout') {
        submitted = true;
        await pending;
      }
      return base(config);
    };
    const fixture = createSessionFixture([], { adapter: delayed });
    const { router, privateLoader } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'My wallet' });
    fireEvent.change(screen.getByLabelText('Private draft'), {
      target: { value: 'private draft' },
    });
    try {
      await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
      const confirmation = await screen.findByRole('dialog', { name: 'Sign out?' });
      expect(submitted).toBe(false);
      expect(fixture.controller.getSnapshot().status).toBe('authenticated');
      expect(screen.getByLabelText('Private draft')).toHaveValue('private draft');
      expect(base).toHaveBeenCalledTimes(3);
      await userEvent.setup().click(within(confirmation).getByRole('button', { name: 'Sign out' }));
      await waitFor(() => expect(submitted).toBe(true));
      expect(screen.getByText('Signing out…')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'My wallet' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Private draft')).not.toBeInTheDocument();
      expect(screen.queryByText(testSession.user.email)).not.toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/wallet');
      expect(privateLoader).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(fixture.controller.getSnapshot().status).toBe('anonymous');
    expect(router.state.location.pathname).toBe('/wallet');
  });

  it('shows Try again after logout failure without restoring private content', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ value: 1 }),
      csrfReply(),
      errorReply('INTERNAL_SERVER_ERROR', 500),
      csrfReply(),
      successReply(),
    ]);
    const { router, privateLoader } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'My wallet' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Sign out' }));
    await screen.findByText('Sign-out not confirmed');
    expect(screen.queryByRole('heading', { name: 'My wallet' })).not.toBeInTheDocument();
    expect(screen.queryByText(testSession.user.email)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(fixture.controller.getSnapshot().status).toBe('logout-pending');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fixture.controller.getSnapshot().status).toBe('anonymous'));
    expect(router.state.location.pathname).toBe('/wallet');
    expect(privateLoader).toHaveBeenCalledTimes(1);
    expect(fixture.adapter).toHaveBeenCalledTimes(7);
  });

  it('provides an explicit logout retry after reloading a pending marker', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply()], {
      initial: {
        version: 1,
        epoch: '10000000-0000-4000-8000-000000000001',
        mode: 'logout-pending',
      },
    });
    const { router, privateLoader } = renderPrivateApp(fixture);
    // The pending and error views both show session feedback. Wait for the
    // guard to commit its error view before targeting a button it can replace.
    await waitFor(() => {
      expect(router.state.status).toBe('idle');
      expect(router.state.isLoading).toBe(false);
      expect(
        router.state.matches.find((match) => match.routeId === '/_authenticated')?.status,
      ).toBe('error');
    });
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(fixture.adapter).not.toHaveBeenCalled();
    await userEvent.setup().click(retry);
    await waitFor(() => expect(fixture.adapter).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fixture.controller.getSnapshot().status).toBe('anonymous'));
    expect(privateLoader).not.toHaveBeenCalled();
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/logout',
    ]);
  });

  it('signs out from the mobile drawer and closes the old account menu', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      media,
      matches: media.includes('max-width'),
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: () => true,
    }));
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ value: 1 }),
      csrfReply(),
      successReply(),
    ]);
    const { router } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'My wallet' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(dialog).getByText(testSession.user.email)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(testSession.user.email)).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/wallet');
  });

  it('keeps the URL and blocks child loader and speculative preload when signed out', async () => {
    const fixture = createSessionFixture([], {
      initial: {
        version: 1,
        epoch: '10000000-0000-4000-8000-000000000001',
        mode: 'signed-out',
      },
    });
    const { router, privateLoader } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'Sign in' });
    await act(() => router.preloadRoute({ to: '/wallet' }));
    expect(router.state.location.pathname).toBe('/wallet');
    expect(privateLoader).not.toHaveBeenCalled();
    expect(fixture.adapter).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'My wallet' })).not.toBeInTheDocument();
  });

  it('opens the child page and loader only after verified bootstrap', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ value: 1 }),
    ]);
    const { privateLoader } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'My wallet' });
    expect(screen.getByText(testSession.user.email)).toBeInTheDocument();
    expect(privateLoader).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.mock.calls[2]?.[0].headers.get('Authorization')).toBe(
      'Bearer test-access',
    );
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('keeps the sign-in form mounted through submission and then opens the current page', async () => {
    const fixture = createSessionFixture(
      [csrfReply(), successReply(testSession), successReply({ value: 1 })],
      {
        initial: { version: 1, epoch: '10000000-0000-4000-8000-000000000001', mode: 'signed-out' },
      },
    );
    const { router, privateLoader } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText(/^Email address/), {
      target: { value: testSession.user.email },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'My wallet' });
    expect(router.state.location.pathname).toBe('/wallet');
    expect(privateLoader).toHaveBeenCalledTimes(1);
    expect(fixture.adapter.mock.calls[1]?.[0].url).toBe('/api/v1/auth/login');
  });

  it('shows access denied without login or private loading for insufficient role', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
    const { privateLoader } = renderPrivateApp(fixture, ['ADMIN']);
    await screen.findByText('Access denied');
    expect(privateLoader).not.toHaveBeenCalled();
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('unmounts old private drafts and reloads the loader for a new user', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ value: 1 }),
      csrfReply(),
      successReply({
        ...testSession,
        user: { ...testSession.user, id: 2, email: 'other@example.com' },
      }),
      successReply({ value: 2 }),
    ]);
    const { privateLoader } = renderPrivateApp(fixture);
    await screen.findByRole('heading', { name: 'My wallet' });
    fireEvent.change(screen.getByLabelText('Private draft'), {
      target: { value: 'old-user draft' },
    });
    await act(() =>
      fixture.controller.login(
        { email: 'other@example.com', password: 'secret' },
        new AbortController().signal,
      ),
    );
    await screen.findByText('other@example.com');
    await waitFor(() => expect(screen.getByLabelText('Private draft')).toHaveValue(''));
    expect(privateLoader).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(testSession.user.email)).not.toBeInTheDocument();
  });
});
