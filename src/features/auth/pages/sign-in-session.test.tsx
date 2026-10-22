import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import type { AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { createApiAdapter, errorReply, successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { parsePaymentResultSearch } from '@/shared/lib/payment-result-context';
import type { SessionController } from '../model/session-controller';
import { SessionProvider } from '../model/session-provider';
import { SignInPage } from './sign-in-page';

const controllers: SessionController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

async function renderLogin(fixture: ReturnType<typeof createSessionFixture>, returnTo?: unknown) {
  controllers.push(fixture.controller);
  const root = createRootRoute({ component: Outlet });
  const login = createRoute({ getParentRoute: () => root, path: '/login', component: SignInPage });
  const wallet = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => <h1>Wallet destination</h1>,
  });
  const register = createRoute({
    getParentRoute: () => root,
    path: '/register',
    component: () => <h1>Previous page</h1>,
  });
  const transfer = createRoute({
    getParentRoute: () => root,
    path: '/transfer',
    component: () => <h1>Transfer destination</h1>,
  });
  const history = createMemoryHistory({ initialEntries: ['/register', '/login'] });
  history.replace('/login', { authReturnTo: returnTo });
  const router = createRouter({
    routeTree: root.addChildren([
      login,
      wallet,
      register,
      transfer,
      createRoute({
        getParentRoute: () => root,
        path: '/deposit',
        component: () => <h1>Top up destination</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/payment/result',
        validateSearch: parsePaymentResultSearch,
        component: () => <h1>Payment result destination</h1>,
      }),
    ]),
    history,
  });
  await act(() => router.load());
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <SessionProvider controller={fixture.controller}>
        <RouterProvider router={router} />
      </SessionProvider>
    </ConfigProvider>,
  );
  return { router, history };
}

describe('public sign-in session handling', () => {
  it.each([
    { target: '/deposit', heading: 'Top up destination', path: '/deposit', search: {} },
    {
      target: '/payment/result?orderId=VNPAY_1',
      heading: 'Payment result destination',
      path: '/payment/result',
      search: { orderId: 'VNPAY_1' },
    },
  ])(
    'returns a verified public login to $target without starting a top-up',
    async ({ target, heading, path, search }) => {
      const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
      const { router } = await renderLogin(fixture, target);
      await screen.findByRole('heading', { name: heading });
      expect(router.state.location.pathname).toBe(path);
      expect(router.state.location.search).toEqual(search);
      expect(fixture.adapter).toHaveBeenCalledTimes(2);
    },
  );

  it('returns an authenticated login page to the allowlisted transfer destination', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
    const { router } = await renderLogin(fixture, '/transfer');
    await screen.findByRole('heading', { name: 'Transfer destination' });
    expect(router.state.location.pathname).toBe('/transfer');
    expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
  });

  it.each(['/wallet', 'https://untrusted.example', '//untrusted.example', undefined])(
    'replaces login with wallet after verified bootstrap for return target %s',
    async (returnTo) => {
      const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
      const { router, history } = await renderLogin(fixture, returnTo);
      await screen.findByRole('heading', { name: 'Wallet destination' });
      expect(router.state.location.pathname).toBe('/wallet');
      expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
      expect(fixture.controller.getAccessIdentity()?.user.email).toBe(testSession.user.email);
      act(() => history.back());
      await screen.findByRole('heading', { name: 'Previous page' });
      expect(router.state.location.pathname).toBe('/register');
    },
  );

  it('shows restoration feedback without a login form until refresh finishes', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createApiAdapter([csrfReply(), successReply(testSession)]);
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh') await pending;
      return base(config);
    };
    const fixture = createSessionFixture([], { adapter });
    const { router } = await renderLogin(fixture);
    try {
      await screen.findByRole('heading', { name: 'Restoring your session…' });
      expect(router.state.location.pathname).toBe('/login');
      expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
    } finally {
      release();
    }
    await screen.findByRole('heading', { name: 'Wallet destination' });
  });

  it('keeps login available when bootstrap rejects the refresh token', async () => {
    const fixture = createSessionFixture([csrfReply(), errorReply('REFRESH_TOKEN_EXPIRED', 401)]);
    const { router } = await renderLogin(fixture);
    await screen.findByLabelText(/^Password/);
    expect(router.state.location.pathname).toBe('/login');
    expect(fixture.controller.getAccessIdentity()).toBeNull();
  });

  it('opens wallet after an explicit successful login without losing the new session', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)], {
      initial: {
        version: 1,
        epoch: '10000000-0000-4000-8000-000000000001',
        mode: 'signed-out',
      },
    });
    await renderLogin(fixture);
    fireEvent.change(await screen.findByLabelText(/^Email address/), {
      target: { value: testSession.user.email },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { name: 'Wallet destination' });
    expect(fixture.controller.getAccessIdentity()?.user.email).toBe(testSession.user.email);
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
    ]);
  });

  it('leaves login after another tab publishes an active session and local refresh verifies it', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)], {
      initial: {
        version: 1,
        epoch: '10000000-0000-4000-8000-000000000001',
        mode: 'signed-out',
      },
    });
    const { router } = await renderLogin(fixture);
    await screen.findByLabelText(/^Password/);
    expect(fixture.adapter).not.toHaveBeenCalled();
    const otherTab = fixture.hub.connect();
    await act(() =>
      otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'active' })),
    );
    await screen.findByRole('heading', { name: 'Wallet destination' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/wallet'));
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
    ]);
    expect(fixture.controller.getAccessIdentity()?.user.email).toBe(testSession.user.email);
  });
});
