import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthenticatedPage } from '@/app/layouts/authenticated-page';
import { ProtectedRouteError } from '@/app/layouts/protected-route-error';
import { SignedOutPage } from '@/app/layouts/signed-out-page';
import { privateRouteContext } from '@/app/private-route';
import { useSessionRouteInvalidation } from '@/app/use-session-route-invalidation';
import type { SessionController } from '@/features/auth/model/session-controller';
import { SessionProvider } from '@/features/auth/model/session-provider';
import { RegisterPage } from '@/features/auth/pages/register-page';
import { parsePaymentResultSearch } from '@/shared/lib/payment-result-context';
import { errorReply, successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { depositKey, makeDepositOrder } from '../api/deposit-fixture.test-support';
import { DEPOSIT_MARKER_KEY } from '../model/deposit-marker';
import { DepositPage } from './deposit-page';
import { PaymentResultPage } from './payment-result-page';

const controllers: SessionController[] = [];
const queryClients: QueryClient[] = [];
beforeEach(() => {
  vi.stubEnv('VITE_VNPAY_TMN_CODE', '');
  window.sessionStorage.removeItem(DEPOSIT_MARKER_KEY);
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
  queryClients.splice(0).forEach((client) => client.clear());
  window.sessionStorage.removeItem(DEPOSIT_MARKER_KEY);
  vi.unstubAllEnvs();
});

function AppRouter({ router }: { router: AnyRouter }) {
  useSessionRouteInvalidation(router);
  return <RouterProvider router={router} />;
}

function renderApp(path: string, fixture: ReturnType<typeof createSessionFixture>) {
  controllers.push(fixture.controller);
  const queryClient = new QueryClient();
  queryClients.push(queryClient);
  const root = createRootRoute({ component: Outlet });
  const privateRoute = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
    beforeLoad: ({ abortController, preload }) =>
      privateRouteContext(
        { session: fixture.controller, privateApi: fixture.privateApi },
        { signal: abortController.signal, preload },
      ),
    staleTime: 0,
    gcTime: 0,
    shouldReload: true,
    pendingMs: 0,
    pendingMinMs: 0,
    component: AuthenticatedPage,
    pendingComponent: SignedOutPage,
    errorComponent: ProtectedRouteError,
  });
  const privateLoader = vi.fn();
  const deposit = createRoute({
    getParentRoute: () => privateRoute,
    path: '/deposit',
    loader: () => {
      privateLoader();
    },
    component: DepositPage,
  });
  const result = createRoute({
    getParentRoute: () => root,
    path: '/payment/result',
    validateSearch: parsePaymentResultSearch,
    component: PaymentResultPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([
      privateRoute.addChildren([deposit]),
      result,
      createRoute({ getParentRoute: () => root, path: '/register', component: RegisterPage }),
      createRoute({
        getParentRoute: () => root,
        path: '/wallet',
        component: () => <h1>Wallet destination</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPreload: false,
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <SessionProvider controller={fixture.controller} privateApi={fixture.privateApi}>
          <AppRouter router={router} />
        </SessionProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { router, privateLoader };
}

function anonymous() {
  return createSessionFixture([], {
    initial: { version: 1, epoch: '10000000-0000-4000-8000-000000000001', mode: 'signed-out' },
  });
}

describe('deposit and payment result route boundaries', () => {
  it('sends one confirmed request and recovers by GET without opening the gateway on lookup', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8080');
    vi.stubEnv('VITE_VNPAY_TMN_CODE', 'TESTCODE');
    vi.stubEnv('VITE_VNPAY_RETURN_URL', '');
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(depositKey);
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      errorReply('INTERNAL_SERVER_ERROR', 500),
      successReply(makeDepositOrder()),
    ]);
    const { router } = renderApp('/deposit', fixture);
    const input = await screen.findByLabelText(/^Amount/);
    fireEvent.change(input, { target: { value: '50000' } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
    const pay = screen.getByRole('button', { name: 'Pay with VNPay' });
    expect(pay).toBeEnabled();
    fireEvent.click(pay);
    fireEvent.click(pay);
    const check = await screen.findByRole('button', { name: 'Check top-up request' });
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
    expect(JSON.parse(window.sessionStorage.getItem(DEPOSIT_MARKER_KEY) ?? '{}')).toEqual({
      userId: 1,
      idempotencyKey: depositKey,
    });
    await user.click(check);
    await screen.findByText('Payment verification is not available yet');
    expect(router.state.location.pathname).toBe('/payment/result');
    expect(router.state.location.search).toEqual({ orderId: makeDepositOrder().orderId });
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      '/api/v1/payment/deposit',
      `/api/v1/payment/deposit/requests/${depositKey}`,
    ]);
    const config = fixture.adapter.mock.calls[2]?.[0];
    expect(config?.data).toBe('{"amount":50000}');
    expect(config?.headers.get('Idempotency-Key')).toBe(depositKey);
  });

  it('keeps a signed-out deposit URL private during navigation and preload', async () => {
    const fixture = anonymous();
    const { router, privateLoader } = renderApp('/deposit', fixture);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/deposit');
    await act(async () => {
      try {
        await router.preloadRoute({ to: '/deposit' });
      } catch {
        /* denied before the child loader */
      }
    });
    expect(privateLoader).not.toHaveBeenCalled();
    expect(screen.queryByRole('form', { name: 'Top-up details' })).not.toBeInTheDocument();
    expect(fixture.adapter).not.toHaveBeenCalled();
  });

  it('signs in at the deposit URL and displays the form without payment API requests', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)], {
      initial: { version: 1, epoch: '10000000-0000-4000-8000-000000000001', mode: 'signed-out' },
    });
    const { router } = renderApp('/deposit', fixture);
    await screen.findByRole('heading', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText(/^Email address/), {
      target: { value: 'member@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Top up' });
    expect(router.state.location.pathname).toBe('/deposit');
    expect(screen.getByRole('form', { name: 'Top-up details' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '10000' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Review top-up' });
    expect(screen.getByRole('button', { name: 'Pay with VNPay' })).toBeDisabled();
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
    ]);
    const otherTab = fixture.hub.connect();
    await act(async () => {
      await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('heading', { name: 'Review top-up' })).not.toBeInTheDocument();
    expect(screen.queryByText('10,000 VND')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/deposit');
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
  });

  it('removes the deposit draft on cross-tab logout without changing its URL', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
    const { router } = renderApp('/deposit', fixture);
    await screen.findByRole('heading', { name: 'Top up' });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '12345' } });
    const otherTab = fixture.hub.connect();
    await act(async () => {
      await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(screen.queryByRole('form', { name: 'Top-up details' })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('12345')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/deposit');
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
  });

  it.each([
    '/payment/result',
    '/payment/result?verification=invalid',
    '/payment/result?verification=unavailable',
    '/payment/result?status=SUCCESS',
    '/payment/result?orderId=../wallet',
    '/payment/result?orderId=VNPAY_1&orderId=VNPAY_2',
  ])('shows only public unconfirmed feedback at %s', async (path) => {
    const fixture = anonymous();
    renderApp(path, fixture);
    await screen.findByRole('heading', { name: 'Top-up result' });
    expect(screen.getByText('The payment result has not been confirmed.')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument();
    expect(screen.queryByText('SUCCESS')).not.toBeInTheDocument();
    expect(fixture.adapter).not.toHaveBeenCalled();
  });

  it('preserves only the order when going from result to registration and back to embedded sign-in', async () => {
    const fixture = anonymous();
    const { router } = renderApp(
      '/payment/result?orderId=VNPAY_1&status=SUCCESS&paymentUrl=https://evil.test',
      fixture,
    );
    await screen.findByRole('heading', { name: 'Sign in' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('link', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Create account' });
    expect(router.state.location.state.authReturnTo).toBe('/payment/result?orderId=VNPAY_1');
    expect(router.state.location.searchStr).toBe('');
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
      'href',
      '/payment/result?orderId=VNPAY_1',
    );
    await user.click(screen.getByRole('link', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/payment/result');
    expect(router.state.location.search).toEqual({ orderId: 'VNPAY_1' });
    expect(fixture.adapter).not.toHaveBeenCalled();
  });

  it('restores a direct result URL and removes private content on cross-tab logout while retaining the order context', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
    const { router } = renderApp('/payment/result?orderId=VNPAY_1', fixture);
    await screen.findByText('Payment verification is not available yet');
    expect(router.state.location.search).toEqual({ orderId: 'VNPAY_1' });
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
    const otherTab = fixture.hub.connect();
    await act(async () => {
      await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() =>
      expect(
        screen.queryByText('Payment verification is not available yet'),
      ).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe('/payment/result');
    expect(router.state.location.search).toEqual({ orderId: 'VNPAY_1' });
    expect(screen.queryByText(testSession.user.email)).not.toBeInTheDocument();
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
  });
});
