import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SessionRole } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { SessionProvider } from '@/features/auth/model/session-provider';
import { WalletPage } from '@/features/wallet/pages/wallet-page';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { AuthenticatedPage } from './layouts/authenticated-page';
import { ProtectedRouteError } from './layouts/protected-route-error';
import { SignedOutPage } from './layouts/signed-out-page';
import { privateRouteContext } from './private-route';
import type { AppRouterContext } from './router-context';
import { useSessionRouteInvalidation } from './use-session-route-invalidation';

const controllers: SessionController[] = [];
beforeEach(() => {
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
});

function TestRouter({ router }: { router: AnyRouter }) {
  useSessionRouteInvalidation(router);
  return <RouterProvider router={router} />;
}

function PrivateWallet() {
  return (
    <>
      <WalletPage />
      <input aria-label="Private draft" />
    </>
  );
}

function renderPrivateApp(
  fixture: ReturnType<typeof createSessionFixture>,
  roles?: readonly SessionRole[],
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
  const router = createRouter({
    routeTree: root.addChildren([protectedRoute.addChildren([wallet])]),
    context: { queryClient, session: fixture.controller, privateApi: fixture.privateApi },
    history: createMemoryHistory({ initialEntries: ['/wallet'] }),
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
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
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
