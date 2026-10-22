import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { describe, expect, it } from 'vitest';

import { DepositForm } from './deposit-form';

const AMOUNT_ERROR = 'Enter a whole VND amount from 10,000 to 50,000,000.';

function renderForm() {
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/deposit', component: DepositForm }),
      createRoute({
        getParentRoute: () => root,
        path: '/wallet',
        component: () => <h1>My wallet</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/deposit'] }),
    defaultPreload: false,
  });
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <RouterProvider router={router} />
    </ConfigProvider>,
  );
  return router;
}

describe('top-up form and preview', () => {
  it('starts without errors, validates on blur and clears an error after correction', async () => {
    renderForm();
    const input = await screen.findByLabelText(/^Amount/);
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText(AMOUNT_ERROR)).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(await screen.findByText(AMOUNT_ERROR)).toHaveAttribute('id');
    expect(input).toHaveAttribute('aria-describedby', screen.getByText(AMOUNT_ERROR).id);
    fireEvent.change(input, { target: { value: '10000' } });
    await waitFor(() => expect(screen.queryByText(AMOUNT_ERROR)).not.toBeInTheDocument());
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it.each(['', '9999', '50000001', '9007199254740993'])(
    'rejects invalid raw input %j without rounding or opening a preview',
    async (amount) => {
      renderForm();
      const input = await screen.findByLabelText(/^Amount/);
      fireEvent.change(input, { target: { value: amount } });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByText(AMOUNT_ERROR);
      await waitFor(() => expect(input).toHaveFocus());
      expect(input).toHaveValue(amount);
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByRole('heading', { name: 'Review top-up' })).not.toBeInTheDocument();
    },
  );

  it.each([
    '10000.50',
    '10000.00',
    '-10000',
    '+10000',
    '1e4',
    '10,000',
    '10.000',
    ' 10000 ',
    'abc',
  ])('keeps the previous amount when non-digit input %j is pasted', async (amount) => {
    renderForm();
    const input = await screen.findByLabelText(/^Amount/);
    fireEvent.change(input, { target: { value: '20000' } });
    const user = userEvent.setup();
    await user.click(input);
    await user.paste(amount);
    expect(input).toHaveValue('20000');
    expect(screen.queryByRole('heading', { name: 'Review top-up' })).not.toBeInTheDocument();
  });

  it.each([
    ['10000', '10,000 VND'],
    ['50000000', '50,000,000 VND'],
    ['012345', '12,345 VND'],
  ])('reviews %s exactly and keeps the draft when going back', async (amount, formatted) => {
    renderForm();
    const input = await screen.findByLabelText(/^Amount/);
    fireEvent.change(input, { target: { value: amount } });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const heading = await screen.findByRole('heading', { name: 'Review top-up' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(formatted)).toBeVisible();
    expect(screen.getByText('VNPay sandbox')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pay with VNPay' })).toBeDisabled();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Go back' }));
    const restored = await screen.findByLabelText(/^Amount/);
    await waitFor(() => expect(restored).toHaveFocus());
    expect(restored).toHaveValue(amount);
    fireEvent.change(restored, { target: { value: '20000' } });
    await user.type(restored, '{Enter}');
    await screen.findByRole('heading', { name: 'Review top-up' });
    expect(screen.getByText('20,000 VND')).toBeVisible();
    expect(screen.queryByText(formatted)).not.toBeInTheDocument();
  });

  it('returns to the wallet without continuing the form', async () => {
    const router = renderForm();
    await screen.findByLabelText(/^Amount/);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Back to wallet' }));
    await screen.findByRole('heading', { name: 'My wallet' });
    expect(router.state.location.pathname).toBe('/wallet');
  });
});
