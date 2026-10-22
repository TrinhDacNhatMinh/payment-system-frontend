import { render, screen } from '@testing-library/react';
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

import { makeDepositOrder } from '../api/deposit-fixture.test-support';
import { depositOrderSchema } from '../api/deposit-schemas';
import type { DepositResultState } from '../model/deposit-result';
import { DepositResult } from './deposit-result';

function renderResult(state: DepositResultState) {
  const operation = {
    checkStatus: vi.fn(async () => undefined),
  };
  const root = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/payment/result',
        component: () => <DepositResult state={state} operation={operation} />,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/wallet',
        component: () => <h1>My wallet</h1>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/deposit',
        component: () => <h1>Top up</h1>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/payment/result'] }),
    defaultPreload: false,
  });
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <RouterProvider router={router} />
    </ConfigProvider>,
  );
  return operation;
}

describe('top-up result presentation', () => {
  it('shows a confirmed receipt and preserves success when the wallet refresh fails', async () => {
    const order = depositOrderSchema.parse({
      ...makeDepositOrder(),
      status: 'SUCCESS',
      paidAt: '2026-10-22T10:05:12.123456',
      canContinuePayment: false,
      paymentUrl: null,
    });
    renderResult({
      status: 'success',
      order,
      wallet: 'error',
      canStartNew: true,
    });
    await screen.findByRole('heading', { name: 'Top-up successful' });
    expect(screen.getByText('50,000 VND')).toBeVisible();
    expect(screen.getByText('10:05 22/10/2026 (GMT+7)')).toBeVisible();
    expect(screen.getByText(order.orderId)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/deposit');
    expect(screen.queryByText('SUCCESS')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Top-up successful' })).toBeVisible();
  });

  it('does not invent a payment timestamp for a legacy success', async () => {
    const order = depositOrderSchema.parse({
      ...makeDepositOrder(),
      status: 'SUCCESS',
      paidAt: null,
      canContinuePayment: false,
      paymentUrl: null,
    });
    renderResult({ status: 'success', order, wallet: 'ready', canStartNew: false });
    await screen.findByRole('heading', { name: 'Top-up successful' });
    expect(screen.queryByText('Completed at')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('shows only wallet and new top-up links for a payable pending order', async () => {
    const order = depositOrderSchema.parse(makeDepositOrder());
    renderResult({ status: 'pending', order, busy: false, automatic: false, canStartNew: true });
    await screen.findByRole('heading', { name: 'Payment pending' });
    expect(
      screen.getByText('Confirmation is taking longer. You can return to your wallet.'),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to wallet' })).toHaveAttribute('href', '/wallet');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/deposit');
  });

  it('does not label an expired pending link as failed', async () => {
    const order = depositOrderSchema.parse({
      ...makeDepositOrder(),
      canContinuePayment: false,
      paymentUrl: null,
    });
    renderResult({ status: 'pending', order, busy: false, automatic: false, canStartNew: true });
    await screen.findByRole('heading', { name: 'Payment pending' });
    expect(screen.queryByRole('button', { name: 'Continue payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Top-up unsuccessful' })).not.toBeInTheDocument();
  });

  it('keeps both navigation links available during a pending read', async () => {
    renderResult({
      status: 'pending',
      order: depositOrderSchema.parse(makeDepositOrder()),
      busy: true,
      automatic: true,
      canStartNew: true,
    });
    await screen.findByRole('heading', { name: 'Payment pending' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to wallet' })).toHaveAttribute('href', '/wallet');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/deposit');
  });

  it('shows an unavailable read without claiming payment failure or displaying private details', async () => {
    const operation = renderResult({
      status: 'unavailable',
      busy: false,
      message: 'Check again shortly.',
    });
    await screen.findByText('Payment status unavailable');
    expect(screen.queryByText('50,000 VND')).not.toBeInTheDocument();
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check status' }));
    expect(operation.checkStatus).toHaveBeenCalledOnce();
  });

  it('shows confirmed failure and provides a fresh top-up only after marker cleanup', async () => {
    const order = depositOrderSchema.parse({
      ...makeDepositOrder(),
      status: 'FAILED',
      canContinuePayment: false,
      paymentUrl: null,
    });
    renderResult({ status: 'failed', order, canStartNew: true });
    await screen.findByRole('heading', { name: 'Top-up unsuccessful' });
    expect(screen.getByRole('link', { name: 'Back to wallet' })).toHaveAttribute('href', '/wallet');
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/deposit');
    expect(screen.queryByRole('button', { name: 'Continue payment' })).not.toBeInTheDocument();
  });
});
