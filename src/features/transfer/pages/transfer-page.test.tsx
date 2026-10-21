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
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { afterEach, describe, expect, it } from 'vitest';

import type { SessionController } from '@/features/auth/model/session-controller';
import { SessionProvider } from '@/features/auth/model/session-provider';
import { errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { TransferPage } from './transfer-page';

const controllers: SessionController[] = [];
const clients: QueryClient[] = [];
const wallet = {
  id: 7,
  userId: testSession.user.id,
  balance: 1000000,
  currency: 'VND',
  updatedAt: '2026-10-21T14:30:00.123456',
};

function renderTransfer(replies: ApiReply[] = [], balanceReply = successReply(wallet)) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const fixture = createSessionFixture(
    [csrfReply(), successReply(testSession), balanceReply, ...replies],
    {
      clearPrivateData: () => {
        void client.cancelQueries();
        client.clear();
      },
    },
  );
  controllers.push(fixture.controller);
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={client}>
        <ConfigProvider theme={{ token: { motion: false } }}>
          <SessionProvider controller={fixture.controller} privateApi={fixture.privateApi}>
            <Outlet />
          </SessionProvider>
        </ConfigProvider>
      </QueryClientProvider>
    ),
  });
  const transfer = createRoute({
    getParentRoute: () => root,
    path: '/transfer',
    component: TransferPage,
  });
  const wallet = createRoute({
    getParentRoute: () => root,
    path: '/wallet',
    component: () => <h1>Wallet destination</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([transfer, wallet]),
    history: createMemoryHistory({ initialEntries: ['/transfer'] }),
    defaultPreload: false,
  });
  render(<RouterProvider router={router} />);
  return { ...fixture, router };
}

function fillDetails(amount = '1000', description?: string) {
  fireEvent.change(screen.getByLabelText(/^Recipient email/), {
    target: { value: ' Recipient@example.com ' },
  });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: amount } });
  if (description !== undefined) {
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: description } });
  }
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  for (const client of clients.splice(0)) client.clear();
});

describe('transfer entry and review', () => {
  it('shows the real balance above the fields and goes back to wallet without sending money', async () => {
    const fixture = renderTransfer();
    const balance = await screen.findByLabelText('Available balance: 1,000,000 VND');
    const email = screen.getByLabelText(/^Recipient email/);
    expect(balance.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Transfer progress' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Go back' }));
    await screen.findByRole('heading', { name: 'Wallet destination' });
    expect(fixture.router.state.location.pathname).toBe('/wallet');
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      '/api/v1/wallet/me',
    ]);
  });

  it('does not replace a balance error with zero or discard the transfer draft', async () => {
    renderTransfer([], errorReply('INTERNAL_SERVER_ERROR', 500));
    await screen.findByText('Balance unavailable');
    expect(screen.queryByLabelText('Available balance: 0 VND')).not.toBeInTheDocument();
    fillDetails('1000', 'keep this draft');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Review transfer' });
    expect(screen.getByText('keep this draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });

  it('starts without errors, validates all fields and focuses the first invalid input', async () => {
    const fixture = renderTransfer();
    const email = await screen.findByLabelText(/^Recipient email/);
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(screen.queryByText('Enter the recipient email address.')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Enter the recipient email address.');
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter the recipient email address.');
    expect(screen.getByLabelText(/^Amount/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('heading', { name: 'Review transfer' })).not.toBeInTheDocument();
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
  });

  it('validates on blur and clears an existing error as the input is corrected', async () => {
    renderTransfer();
    const amount = await screen.findByLabelText(/^Amount/);
    fireEvent.change(amount, { target: { value: '1000.50' } });
    fireEvent.blur(amount);
    await screen.findByText('Enter a whole VND amount from 1,000 to 50,000,000.');
    fireEvent.change(amount, { target: { value: '1000' } });
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'false'));
    expect(
      screen.queryByText('Enter a whole VND amount from 1,000 to 50,000,000.'),
    ).not.toBeInTheDocument();
  });

  it.each(['999', '50000001', '1000.00', '1e3', '1,000'])(
    'keeps invalid amount %s editable instead of rounding or opening review',
    async (amount) => {
      const fixture = renderTransfer();
      await screen.findByRole('form', { name: 'Transfer details' });
      fillDetails(amount);
      await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() => expect(screen.getByLabelText(/^Amount/)).toHaveFocus());
      expect(screen.getByLabelText(/^Amount/)).toHaveValue(amount);
      expect(screen.queryByRole('heading', { name: 'Review transfer' })).not.toBeInTheDocument();
      expect(fixture.adapter).toHaveBeenCalledTimes(3);
    },
  );

  it('focuses a description longer than 255 characters without truncating it', async () => {
    renderTransfer();
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails('1000', 'x'.repeat(256));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByText('Use at most 255 characters for the description.');
    await waitFor(() => expect(screen.getByLabelText(/^Description/)).toHaveFocus());
    expect(screen.getByLabelText(/^Description/)).toHaveValue('x'.repeat(256));
  });

  it('reviews exact values, preserves the draft on edit and requires reviewing changes again', async () => {
    const fixture = renderTransfer();
    await screen.findByRole('form', { name: 'Transfer details' });
    const user = userEvent.setup();
    const description = '  lunch\n  tomorrow  ';
    fillDetails('50000000', description);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const review = await screen.findByRole('heading', { name: 'Review transfer' });
    await waitFor(() => expect(review).toHaveFocus());
    expect(screen.getByText('Recipient@example.com')).toBeInTheDocument();
    expect(screen.getByText('50,000,000 VND')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.tagName === 'DD' && element.textContent === description,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
    expect(fixture.router.state.location.searchStr).toBe('');
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    const email = await screen.findByLabelText(/^Recipient email/);
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveValue('Recipient@example.com');
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('50000000');
    expect(screen.getByLabelText(/^Description/)).toHaveValue(description);
    expect(screen.queryByRole('heading', { name: 'Review transfer' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1000' } });
    screen.getByLabelText(/^Amount/).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('heading', { name: 'Review transfer' });
    expect(screen.getByText('1,000 VND')).toBeInTheDocument();
    expect(screen.queryByText('50,000,000 VND')).not.toBeInTheDocument();
    expect(fixture.adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      '/api/v1/wallet/me',
    ]);
  });

  it('clears a previous review and draft when the account changes', async () => {
    const fixture = renderTransfer([
      csrfReply(),
      successReply({
        ...testSession,
        user: { ...testSession.user, id: 2, email: 'other@example.com' },
      }),
      successReply({ ...wallet, userId: 2, balance: 5000 }),
    ]);
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails('1000', 'private draft');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Review transfer' });
    await act(() =>
      fixture.controller.login(
        { email: 'other@example.com', password: 'secret' },
        new AbortController().signal,
      ),
    );
    await screen.findByRole('form', { name: 'Transfer details' });
    expect(screen.getByLabelText(/^Recipient email/)).toHaveValue('');
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('');
    expect(screen.getByLabelText(/^Description/)).toHaveValue('');
    expect(screen.queryByText('private draft')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Review transfer' })).not.toBeInTheDocument();
  });
});
