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
import { describe, expect, it, vi } from 'vitest';

import { parsePaymentResultSearch } from '@/shared/lib/payment-result-context';

import { AuthFormActionsProvider } from '../model/auth-form-actions-provider';
import type { AuthFormActions } from '../model/auth-form-actions';
import { RegisterPage } from './register-page';
import { SignInPage } from './sign-in-page';

const registeredUser = {
  id: 1,
  email: 'member@example.com',
  fullName: 'Member',
  role: 'USER',
  status: 'ACTIVE',
} as const;

async function renderPages(
  path: '/wallet' | '/transfer' | '/deposit' | '/register' | `/payment/result?orderId=${string}`,
  actions: AuthFormActions,
) {
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => root, path: '/login', component: SignInPage }),
    createRoute({ getParentRoute: () => root, path: '/register', component: RegisterPage }),
    createRoute({
      getParentRoute: () => root,
      path: '/wallet',
      component: () => <SignInPage embedded />,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/transfer',
      component: () => <SignInPage embedded />,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/deposit',
      component: () => <SignInPage embedded />,
    }),
    createRoute({
      getParentRoute: () => root,
      path: '/payment/result',
      validateSearch: parsePaymentResultSearch,
      component: () => <SignInPage embedded />,
    }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await act(() => router.load());
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthFormActionsProvider actions={actions}>
        <RouterProvider router={router} />
      </AuthFormActionsProvider>
    </ConfigProvider>,
  );
  return router;
}

describe('registration navigation', () => {
  it.each(['/wallet', '/transfer', '/deposit', '/payment/result?orderId=VNPAY_1'] as const)(
    'preserves %s through registration without logging in',
    async (path) => {
      const login = vi.fn().mockResolvedValue(undefined);
      const register = vi.fn().mockResolvedValue(registeredUser);
      const router = await renderPages(path, { login, register });
      await userEvent.setup().click(await screen.findByRole('link', { name: 'Create account' }));
      await screen.findByLabelText(/^Full name/);
      expect(router.state.location.pathname).toBe('/register');
      expect(router.state.location.state.authReturnTo).toBe(path);
      fireEvent.change(screen.getByLabelText(/^Full name/), { target: { value: 'Member' } });
      fireEvent.change(screen.getByLabelText(/^Email address/), {
        target: { value: 'member@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/^Phone number/), { target: { value: 'any phone' } });
      fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'secret' } });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Create account' }));
      await screen.findByRole('heading', { name: 'Account created' });
      expect(register).toHaveBeenCalledTimes(1);
      expect(login).not.toHaveBeenCalled();
      expect(screen.queryByLabelText(/^Password/)).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', path);
      expect(router.state.location.searchStr).toBe('');
      await userEvent.setup().click(screen.getByRole('link', { name: 'Go to sign in' }));
      await waitFor(() => expect(router.state.location.pathname).toBe(path.split('?')[0]));
      expect(router.state.location.searchStr).toBe(path.includes('?') ? '?orderId=VNPAY_1' : '');
      expect(login).not.toHaveBeenCalled();
    },
  );

  it('returns direct registrations to the public sign-in page', async () => {
    await renderPages('/register', { login: vi.fn(), register: vi.fn() });
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });
});
