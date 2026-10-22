import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionController } from '@/features/auth/model/session-controller';
import { SessionProvider } from '@/features/auth/model/session-provider';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { createTransferMarkerStore, TRANSFER_MARKER_KEY } from '../model/transfer-marker';
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

function renderTransfer(
  replies: ApiReply[] = [],
  balanceReply = successReply(wallet),
  wrapAdapter?: (base: AxiosAdapter) => AxiosAdapter,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const adapter = createApiAdapter([
    csrfReply(),
    successReply(testSession),
    balanceReply,
    ...replies,
  ]);
  const fixture = createSessionFixture([], {
    adapter: wrapAdapter?.(adapter) ?? adapter,
    clearPrivateData: () => {
      void client.cancelQueries();
      client.clear();
    },
  });
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
  return { ...fixture, router, adapter };
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

beforeEach(() => window.sessionStorage.removeItem(TRANSFER_MARKER_KEY));
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  for (const client of clients.splice(0)) client.clear();
  window.sessionStorage.removeItem(TRANSFER_MARKER_KEY);
});

describe('transfer entry and review', () => {
  it('edits a declined transfer and requires Continue and Confirm again before creating a new intent', async () => {
    const fixture = renderTransfer([
      errorReply('WALLET_INSUFFICIENT_BALANCE', 400),
      successReply({
        transactionId: 101,
        amount: '2000',
        fromWalletBalance: '998000',
        status: 'SUCCESS',
        createdAt: '2026-10-21T14:30:00',
      }),
      successReply({ ...wallet, balance: 998000 }),
    ]);
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails('1000', '  lunch  ');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
    await screen.findByRole('heading', { name: 'Transfer declined' });
    expect(createTransferMarkerStore().read()).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit transfer details' }));
    expect(await screen.findByLabelText(/^Recipient email/)).toHaveValue('Recipient@example.com');
    expect(screen.getByLabelText(/^Recipient email/)).toHaveFocus();
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('1000');
    expect(screen.getByLabelText(/^Description/)).toHaveValue('  lunch  ');
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '2000' } });
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const posts = () =>
      fixture.adapter.mock.calls
        .map(([config]) => config)
        .filter((config) => config.url === '/api/v1/transfer');
    expect(posts()).toHaveLength(1);
    await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
    await screen.findByRole('heading', { name: 'Transfer successful' });
    expect(posts()).toHaveLength(2);
    expect(posts()[1]?.headers.get('Idempotency-Key')).not.toBe(
      posts()[0]?.headers.get('Idempotency-Key'),
    );
    await user.click(screen.getByRole('button', { name: 'Make another transfer' }));
    expect(await screen.findByLabelText(/^Recipient email/)).toHaveValue('');
    expect(screen.getByLabelText(/^Recipient email/)).toHaveFocus();
    expect(screen.getByLabelText(/^Amount/)).toHaveValue('');
    expect(createTransferMarkerStore().read()).toBeNull();
    expect(posts()).toHaveLength(2);
  });

  it('recovers PENDING after reload using GET, rechecks the wallet and requires review before resuming', async () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    createTransferMarkerStore().save({ userId: 1, idempotencyKey: key });
    const request = { toEmail: 'Other@example.com', amount: '1000', description: '  lunch  ' };
    const fixture = renderTransfer([
      successReply({
        idempotencyKey: key,
        state: 'PENDING',
        request,
        result: null,
        error: null,
        legacyFractional: false,
      }),
      successReply(wallet),
      successReply({
        transactionId: 102,
        amount: '1000',
        fromWalletBalance: '999000',
        status: 'SUCCESS',
        createdAt: '2026-10-21T14:30:00',
      }),
      successReply({ ...wallet, balance: 999000 }),
    ]);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
    await screen.findByLabelText('Available balance: 1,000,000 VND');
    await user.click(screen.getByRole('button', { name: 'Check transfer status' }));
    const review = await screen.findByRole('button', { name: 'Review and resume transfer' });
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
    ).toHaveLength(0);
    await user.click(review);
    const heading = await screen.findByRole('heading', { name: 'Review pending transfer' });
    expect(heading).toHaveFocus();
    expect(screen.getByText('Other@example.com')).toBeVisible();
    expect(screen.getByText('1,000 VND')).toBeVisible();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Go back' }));
    await user.click(screen.getByRole('button', { name: 'Review and resume transfer' }));
    const confirm = screen.getByRole('button', { name: 'Confirm and resume' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await screen.findByRole('heading', { name: 'Transfer successful' });
    const posts = fixture.adapter.mock.calls
      .map(([config]) => config)
      .filter((config) => config.url === '/api/v1/transfer');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.headers.get('Idempotency-Key')).toBe(key);
    expect(posts[0]?.data).toBe(JSON.stringify(request));
  });

  it.each([
    { amount: '1000.50', display: '1,000.50 VND', legacyFractional: true },
    { amount: '50000001', display: '50,000,001 VND', legacyFractional: false },
  ])(
    'keeps pending amount $amount read-only instead of resuming outside the current contract',
    async ({ amount, display, legacyFractional }) => {
      const key = '550e8400-e29b-41d4-a716-446655440000';
      createTransferMarkerStore().save({ userId: 1, idempotencyKey: key });
      const fixture = renderTransfer([
        successReply({
          idempotencyKey: key,
          state: 'PENDING',
          request: { toEmail: 'Other@example.com', amount, description: null },
          result: null,
          error: null,
          legacyFractional,
        }),
      ]);
      await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
      await screen.findByLabelText('Available balance: 1,000,000 VND');
      await userEvent.setup().click(screen.getByRole('button', { name: 'Check transfer status' }));
      expect(await screen.findByText(display)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Review and resume transfer' }),
      ).not.toBeInTheDocument();
      expect(
        fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
      ).toHaveLength(0);
      expect(createTransferMarkerStore().read()?.idempotencyKey).toBe(key);
    },
  );

  it('does not invent missing details or enable a new transfer after reload and lookup 404', async () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    createTransferMarkerStore().save({ userId: 1, idempotencyKey: key });
    const fixture = renderTransfer([errorReply('TRANSFER_REQUEST_NOT_FOUND', 404)]);
    await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
    await screen.findByLabelText('Available balance: 1,000,000 VND');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check transfer status' }));
    await screen.findByText(/details are no longer available/);
    expect(
      screen.queryByRole('button', { name: 'Review and resume transfer' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make another transfer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Transfer details' })).not.toBeInTheDocument();
    expect(createTransferMarkerStore().read()?.idempotencyKey).toBe(key);
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
    ).toHaveLength(0);
  });

  it('renews an expired session through a user-requested status GET without replaying the POST', async () => {
    const fixture = renderTransfer([
      errorReply('TOKEN_EXPIRED', 401),
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply({ ...testSession, accessToken: 'renewed' }),
      errorReply('TRANSFER_REQUEST_NOT_FOUND', 404),
      successReply(wallet),
    ]);
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
    await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/auth/refresh'),
    ).toHaveLength(1);
    const marker = createTransferMarkerStore().read();
    await user.click(screen.getByRole('button', { name: 'Check transfer status' }));
    await screen.findByText(/does not confirm/);
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/auth/refresh'),
    ).toHaveLength(2);
    expect(
      fixture.adapter.mock.calls.filter(
        ([config]) => config.url === `/api/v1/transfer/requests/${marker?.idempotencyKey}`,
      ),
    ).toHaveLength(2);
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
    ).toHaveLength(1);
    expect(createTransferMarkerStore().read()).toEqual(marker);
    expect(fixture.controller.getAccessToken()).toBe('renewed');
  });

  it('sends one confirmed POST, displays the receipt and fetches a fresh wallet snapshot', async () => {
    const receipt = {
      transactionId: 91,
      amount: '1000',
      fromWalletBalance: '999000',
      status: 'SUCCESS',
      createdAt: '2026-10-21T14:30:00.123456',
    };
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    let posts = 0;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fixture = renderTransfer(
      [successReply(receipt), successReply({ ...wallet, balance: 998999 })],
      successReply(wallet),
      (base) => async (config) => {
        if (config.url === '/api/v1/transfer') {
          posts += 1;
          started();
          await pending;
        }
        return base(config);
      },
    );
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails('1000', '  lunch  ');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm transfer' });
    try {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
      await submitted;
      expect(posts).toBe(1);
      expect(screen.queryByRole('button', { name: 'Confirm transfer' })).not.toBeInTheDocument();
      const marker = createTransferMarkerStore().read();
      expect(marker).toMatchObject({ userId: 1, idempotencyKey: expect.any(String) });
      expect(Object.keys(marker ?? {}).sort()).toEqual(['idempotencyKey', 'userId']);
    } finally {
      release();
    }
    await screen.findByRole('heading', { name: 'Transfer successful' });
    expect(await screen.findByLabelText('Available balance: 998,999 VND')).not.toBeVisible();
    expect(screen.getByText('1,000 VND')).toBeVisible();
    expect(screen.getByText('Recipient@example.com')).toBeVisible();
    expect(screen.getByText('lunch').textContent).toBe('  lunch  ');
    expect(screen.getByText('21 Oct 2026, 14:30')).toHaveAttribute('dateTime', receipt.createdAt);
    expect(screen.queryByText('999,000 VND')).not.toBeInTheDocument();
    expect(screen.queryByText('91')).not.toBeInTheDocument();
    expect(screen.queryByText('SUCCESS')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to wallet' })).toHaveAttribute('href', '/wallet');
    const post = fixture.adapter.mock.calls
      .map(([config]) => config)
      .filter((config) => config.url === '/api/v1/transfer');
    expect(post).toHaveLength(1);
    expect(post[0]?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/i);
    expect(post[0]?.data).toBe(
      JSON.stringify({
        toEmail: 'Recipient@example.com',
        amount: '1000',
        description: '  lunch  ',
      }),
    );
    expect(createTransferMarkerStore().read()).toBeNull();
  });

  it('keeps transfer success visible if refreshing the current wallet fails', async () => {
    renderTransfer([
      successReply({
        transactionId: 92,
        amount: '1000',
        fromWalletBalance: '999000',
        status: 'SUCCESS',
        createdAt: '2026-10-21T14:30:00',
      }),
      errorReply('INTERNAL_SERVER_ERROR', 500),
    ]);
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
    await screen.findByText('Transfer succeeded. Your current balance could not be updated.');
    expect(screen.getByRole('heading', { name: 'Transfer successful' })).toBeInTheDocument();
    expect(screen.queryByText('Message')).not.toBeInTheDocument();
    expect(screen.queryByText('No description')).not.toBeInTheDocument();
  });

  it('does not let a late pre-transfer wallet read overwrite the refreshed balance', async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submitted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let reads = 0;
    renderTransfer(
      [
        successReply({
          transactionId: 94,
          amount: '1000',
          fromWalletBalance: '999000',
          status: 'SUCCESS',
          createdAt: '2026-10-21T14:30:00',
        }),
        successReply({ ...wallet, balance: 998999 }),
      ],
      successReply(wallet),
      (base) => async (config) => {
        const response = await base(config);
        if (config.url === '/api/v1/wallet/me' && ++reads === 1) {
          started();
          await pending;
        }
        return response;
      },
    );
    try {
      await submitted;
      await screen.findByRole('form', { name: 'Transfer details' });
      fillDetails();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
      await screen.findByLabelText('Available balance: 998,999 VND');
    } finally {
      await act(async () => {
        release();
        await pending;
      });
    }
    expect(screen.getByLabelText('Available balance: 998,999 VND')).toBeInTheDocument();
    expect(screen.queryByLabelText('Available balance: 1,000,000 VND')).not.toBeInTheDocument();
  });

  it('keeps timeout and lookup 404 unknown without sending another POST', async () => {
    const fixture = renderTransfer([
      new AxiosError('private payload', 'ECONNABORTED'),
      errorReply('TRANSFER_REQUEST_NOT_FOUND', 404),
      successReply(wallet),
    ]);
    await screen.findByRole('form', { name: 'Transfer details' });
    fillDetails();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
    await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
    const marker = createTransferMarkerStore().read();
    await user.click(screen.getByRole('button', { name: 'Check transfer status' }));
    await screen.findByText(/does not confirm/);
    expect(createTransferMarkerStore().read()).toEqual(marker);
    expect(screen.queryByRole('form', { name: 'Transfer details' })).not.toBeInTheDocument();
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
    ).toHaveLength(1);
    expect(
      fixture.adapter.mock.calls.some(
        ([config]) => config.url === `/api/v1/transfer/requests/${marker?.idempotencyKey}`,
      ),
    ).toBe(true);
    expect(screen.queryByText(/private payload/)).not.toBeInTheDocument();
  });

  it('does not queue an offline money command for replay after reconnect', async () => {
    const fixture = renderTransfer([new AxiosError('offline', 'ERR_NETWORK')]);
    await screen.findByLabelText('Available balance: 1,000,000 VND');
    fillDetails();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    onlineManager.setOnline(false);
    try {
      await user.click(await screen.findByRole('button', { name: 'Confirm transfer' }));
      await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
      expect(
        fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
      ).toHaveLength(1);
      await act(async () => {
        onlineManager.setOnline(true);
      });
      expect(
        fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
      ).toHaveLength(1);
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it('restores an existing marker through GET only and displays an exact legacy receipt', async () => {
    const key = '550e8400-e29b-41d4-a716-446655440000';
    createTransferMarkerStore().save({ userId: 1, idempotencyKey: key });
    const fixture = renderTransfer([
      successReply({
        idempotencyKey: key,
        state: 'SUCCEEDED',
        request: { toEmail: 'Other@example.com', amount: '1000.50', description: null },
        result: {
          transactionId: 93,
          amount: '1000.50',
          fromWalletBalance: '0.25',
          status: 'SUCCESS',
          createdAt: '2026-10-21T14:30:00',
        },
        error: null,
        legacyFractional: true,
      }),
      successReply(wallet),
    ]);
    await screen.findByRole('heading', { name: 'Transfer outcome is unknown' });
    expect(
      fixture.adapter.mock.calls.some(([config]) => config.url?.includes('/transfer/requests/')),
    ).toBe(false);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check transfer status' }));
    await screen.findByRole('heading', { name: 'Transfer successful' });
    expect(screen.getByText('1,000.50 VND')).toBeInTheDocument();
    expect(screen.queryByText('0.25 VND')).not.toBeInTheDocument();
    expect(
      fixture.adapter.mock.calls.filter(([config]) => config.url === '/api/v1/transfer'),
    ).toHaveLength(0);
  });

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
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeEnabled();
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
    fireEvent.change(amount, { target: { value: '999' } });
    fireEvent.blur(amount);
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(amount, { target: { value: '1000' } });
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'false'));
    expect(
      screen.queryByText('Enter a whole VND amount from 1,000 to 50,000,000.'),
    ).not.toBeInTheDocument();
  });

  it.each(['999', '50000001'])(
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

  it.each(['1000.00', '1e3', '1,000', '-1000', '+1000', 'abc', ' 1000 '])(
    'rejects non-digit amount input %s without changing the existing amount',
    async (value) => {
      renderTransfer();
      const amount = await screen.findByLabelText(/^Amount/);
      fireEvent.change(amount, { target: { value: '2000' } });
      fireEvent.change(amount, { target: { value } });
      expect(amount).toHaveValue('2000');
      fireEvent.change(amount, { target: { value: '' } });
      expect(amount).toHaveValue('');
    },
  );

  it('limits description input to 255 characters, including pasted text', async () => {
    renderTransfer();
    await screen.findByRole('form', { name: 'Transfer details' });
    const description = screen.getByLabelText(/^Description/);
    expect(description).toHaveAttribute('maxlength', '255');
    const user = userEvent.setup();
    await user.click(description);
    await user.paste('x'.repeat(256));
    expect(description).toHaveValue('x'.repeat(255));
    await user.keyboard('y');
    expect(description).toHaveValue('x'.repeat(255));
    fireEvent.change(description, { target: { value: 'z'.repeat(256) } });
    expect(description).toHaveValue('z'.repeat(255));
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
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeEnabled();
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
