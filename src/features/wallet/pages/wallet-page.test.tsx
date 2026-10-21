import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider } from 'antd';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { SessionProvider } from '@/features/auth/model/session-provider';
import type { SessionController } from '@/features/auth/model/session-controller';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { WalletPage } from './wallet-page';

const controllers: SessionController[] = [];
const clients: QueryClient[] = [];
const wallet = {
  id: 7,
  userId: testSession.user.id,
  balance: 12000,
  currency: 'VND',
  updatedAt: '2026-10-21T14:30:00.123456',
};

function renderWallet(replies: ApiReply[], adapter?: AxiosAdapter) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const fixture = createSessionFixture([csrfReply(), successReply(testSession), ...replies], {
    adapter,
    clearPrivateData: () => {
      void client.cancelQueries();
      client.clear();
    },
  });
  clients.push(client);
  controllers.push(fixture.controller);
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <SessionProvider controller={fixture.controller} privateApi={fixture.privateApi}>
          <WalletPage />
        </SessionProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { ...fixture, client };
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  for (const client of clients.splice(0)) client.clear();
});

describe('wallet page with session-bound API', () => {
  it('does not request or display wallet data while the session is still restoring', async () => {
    let release: () => void = () => undefined;
    let markRestoring: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restoring = new Promise<void>((resolve) => {
      markRestoring = resolve;
    });
    const base = createApiAdapter([csrfReply(), successReply(testSession), successReply(wallet)]);
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh') {
        markRestoring();
        await pending;
      }
      return base(config);
    };
    renderWallet([], adapter);
    try {
      await restoring;
      expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument();
      expect(base.mock.calls.map(([config]) => config.url)).toEqual(['/api/v1/auth/csrf']);
    } finally {
      release();
    }
    await screen.findByLabelText('Available balance: 12,000 VND');
  });

  it('shows zero without timestamps, explanatory copy or unfinished actions', async () => {
    const fixture = renderWallet([successReply({ ...wallet, balance: 0 })]);
    await screen.findByLabelText('Available balance: 0 VND');
    expect(screen.queryByText(/Oct 21, 2026/)).not.toBeInTheDocument();
    for (const name of ['Top up', 'Transfer', 'Transaction history']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    for (const text of [
      'Wallet actions',
      'These actions are not available yet.',
      'Your wallet balance is zero.',
      'Balance at last successful refresh.',
    ]) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'Refresh balance' })).not.toBeInTheDocument();
    expect(screen.queryByText('Wallet is not available yet')).not.toBeInTheDocument();
    expect(fixture.adapter.mock.calls[2]?.[0].url).toBe('/api/v1/wallet/me');
  });

  it('keeps all digits of a large balance available for responsive presentation', async () => {
    renderWallet([successReply({ ...wallet, balance: Number.MAX_SAFE_INTEGER })]);
    await screen.findByLabelText('Available balance: 9,007,199,254,740,991 VND');
    expect(screen.getByText('9,007,199,254,740,991')).toBeVisible();
    expect(screen.queryByText(/Oct 21, 2026/)).not.toBeInTheDocument();
  });

  it('shows loading without a fabricated balance before the first wallet response', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createApiAdapter([csrfReply(), successReply(testSession), successReply(wallet)]);
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/wallet/me') await pending;
      return base(config);
    };
    renderWallet([], adapter);
    try {
      await screen.findByRole('status', { name: 'Loading your wallet' });
      expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refresh balance' })).not.toBeInTheDocument();
    } finally {
      release();
    }
    await screen.findByLabelText('Available balance: 12,000 VND');
  });

  it('offers an explicit retry after a load error without displaying zero', async () => {
    const fixture = renderWallet([
      new AxiosError('private server details', 'ERR_NETWORK'),
      successReply(wallet),
    ]);
    await screen.findByText('Unable to load your wallet');
    expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/private server details/)).not.toBeInTheDocument();
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Available balance: 12,000 VND');
    expect(fixture.adapter).toHaveBeenCalledTimes(4);
  });

  it('keeps a previous snapshot clearly marked during refresh and after a refresh error', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      successReply(wallet),
      errorReply('INTERNAL_SERVER_ERROR', 500),
      successReply({ ...wallet, balance: 9000 }),
    ]);
    let reads = 0;
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/wallet/me' && ++reads === 2) await pending;
      return base(config);
    };
    const fixture = renderWallet([], adapter);
    await screen.findByLabelText('Available balance: 12,000 VND');
    try {
      act(() => {
        void fixture.client.refetchQueries({ type: 'active' }, { cancelRefetch: false });
      });
      await waitFor(() => expect(reads).toBe(2));
      expect(screen.getByRole('heading', { name: 'Available balance' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Last known balance' })).not.toBeInTheDocument();
      expect(screen.getByLabelText('Available balance: 12,000 VND')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Refresh balance' })).not.toBeInTheDocument();
    } finally {
      release();
    }
    await screen.findByText('Couldn’t refresh balance');
    expect(screen.getByRole('heading', { name: 'Last known balance' })).toBeInTheDocument();
    expect(screen.getByLabelText('Available balance: 12,000 VND')).toBeInTheDocument();
    await act(async () => {
      await fixture.client.refetchQueries({ type: 'active' }, { cancelRefetch: false });
    });
    await screen.findByLabelText('Available balance: 9,000 VND');
    expect(screen.queryByText('Couldn’t refresh balance')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Available balance' })).toBeInTheDocument();
    expect(base).toHaveBeenCalledTimes(5);
  });

  it('masks the balance through refetch and reveals the latest value on request', async () => {
    const fixture = renderWallet([
      successReply(wallet),
      successReply({ ...wallet, balance: 9000 }),
    ]);
    await screen.findByLabelText('Available balance: 12,000 VND');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Hide balance' }));
    expect(screen.getByLabelText('Balance hidden')).toHaveTextContent('••••••');
    expect(screen.queryByText('12,000')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument();

    await act(async () => {
      await fixture.client.refetchQueries({ type: 'active' }, { cancelRefetch: false });
    });
    expect(screen.getByLabelText('Balance hidden')).toBeInTheDocument();
    expect(screen.queryByText('9,000')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument();

    const showBalance = screen.getByRole('button', { name: 'Show balance' });
    showBalance.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Available balance: 9,000 VND')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide balance' })).toHaveFocus();
    expect(fixture.adapter).toHaveBeenCalledTimes(4);
  });

  it.each([
    errorReply('WALLET_NOT_FOUND', 404),
    successReply({ ...wallet, userId: 99 }),
    successReply({ ...wallet, balance: Number.MAX_SAFE_INTEGER + 1 }),
    successReply({ ...wallet, balance: 1000.5 }),
    successReply({ ...wallet, balance: 0.001 }),
  ])(
    'does not display a balance for missing, foreign or unsupported wallet data',
    async (reply) => {
      renderWallet([reply]);
      await screen.findByRole('button', { name: 'Try again' });
      expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument();
    },
  );

  it('drops displayed balance and ignores a late refresh after another tab signs out', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      successReply(wallet),
      successReply({ ...wallet, balance: 7777 }),
    ]);
    let reads = 0;
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/wallet/me' && ++reads === 2) await pending;
      return base(config);
    };
    const fixture = renderWallet([], adapter);
    await screen.findByLabelText('Available balance: 12,000 VND');
    act(() => {
      void fixture.client.refetchQueries({ type: 'active' }, { cancelRefetch: false });
    });
    await waitFor(() => expect(reads).toBe(2));
    const otherTab = fixture.hub.connect();
    try {
      await act(() =>
        otherTab.change(() => ({
          version: 1,
          epoch: otherTab.newEpoch(),
          mode: 'signed-out',
        })),
      );
      await waitFor(() =>
        expect(screen.queryByLabelText(/^Available balance:/)).not.toBeInTheDocument(),
      );
    } finally {
      await act(async () => {
        release();
        await pending;
      });
    }
    await waitFor(() => expect(base).toHaveBeenCalledTimes(4));
    expect(screen.queryByLabelText('Available balance: 7,777 VND')).not.toBeInTheDocument();
    expect(
      fixture.client
        .getQueryCache()
        .findAll()
        .every((query) => query.state.data === undefined),
    ).toBe(true);
  });
});
