import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionRouteInvalidation } from '@/app/use-session-route-invalidation';
import { SessionProvider } from '@/features/auth/model/session-provider';
import type { SessionController } from '@/features/auth/model/session-controller';
import { routeTree } from '@/routeTree.gen';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { MY_TRANSACTIONS_PATH } from '../api/transaction-api';
import { transactionPage } from '../api/transaction-fixture.test-support';

const controllers: SessionController[] = [];
const clients: QueryClient[] = [];

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
  for (const client of clients.splice(0)) client.clear();
});

function TestRouter({ router }: { router: AnyRouter }) {
  useSessionRouteInvalidation(router);
  return <RouterProvider router={router} />;
}

function renderTransactions(
  replies: ApiReply[],
  options: Parameters<typeof createSessionFixture>[1] = {},
  initialEntry = '/transactions',
) {
  const client = new QueryClient();
  const fixture = createSessionFixture(replies, {
    ...options,
    clearPrivateData: () => {
      void client.cancelQueries();
      client.clear();
    },
  });
  controllers.push(fixture.controller);
  clients.push(client);
  const router = createRouter({
    routeTree,
    context: { queryClient: client, session: fixture.controller, privateApi: fixture.privateApi },
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
    defaultPreload: false,
  });
  render(
    <QueryClientProvider client={client}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <SessionProvider controller={fixture.controller} privateApi={fixture.privateApi}>
          <TestRouter router={router} />
        </SessionProvider>
      </ConfigProvider>
    </QueryClientProvider>,
  );
  return { ...fixture, client, router };
}

describe('transactions private page', () => {
  it('restores URL filters and blocks invalid search until reset without a history request', async () => {
    const fixture = renderTransactions(
      [csrfReply(), successReply(testSession), successReply(transactionPage)],
      {},
      '/transactions?type=INVALID&page=0',
    );
    await screen.findByText('Invalid filters');
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset filters' }));
    await screen.findByText('1 transaction');
    expect(fixture.router.state.location.search).toEqual({});
    expect(fixture.adapter.mock.calls[2]?.[0].params).toEqual({ page: 0, size: 10 });
  });

  it('applies a draft at page one and restores filters with Back and Forward', async () => {
    const initial = {
      ...transactionPage,
      page: 2,
      size: 20,
      content: [],
      totalElements: 0,
      totalPages: 0,
    };
    const applied = { ...transactionPage, size: 20 };
    const fixture = renderTransactions(
      [
        csrfReply(),
        successReply(testSession),
        successReply(initial),
        successReply(applied),
        successReply(initial),
        successReply(applied),
        successReply(applied),
      ],
      {},
      '/transactions?type=TRANSFER_OUT&status=SUCCESS&fromDate=2026-10-20&toDate=2026-10-22&page=3&size=20',
    );
    await screen.findByRole('heading', { name: 'No matching transactions' });
    expect(fixture.adapter.mock.calls[2]?.[0].params).toEqual({
      type: 'TRANSFER_OUT',
      status: 'SUCCESS',
      fromDate: '2026-10-20T00:00:00',
      toDate: '2026-10-22T23:59:59.999999',
      page: 2,
      size: 20,
    });
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-21' } });
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('1 transaction');
    expect(fixture.router.state.location.search).toEqual({
      type: 'TRANSFER_OUT',
      status: 'SUCCESS',
      fromDate: '2026-10-21',
      toDate: '2026-10-22',
      size: 20,
    });
    expect(fixture.adapter.mock.calls[3]?.[0].params).toMatchObject({
      fromDate: '2026-10-21T00:00:00',
      page: 0,
      size: 20,
    });
    await act(async () => {
      fixture.router.history.back();
    });
    await screen.findByRole('heading', { name: 'No matching transactions' });
    expect(screen.getByLabelText('From date')).toHaveValue('2026-10-20');
    await act(async () => {
      fixture.router.history.forward();
    });
    await screen.findByText('1 transaction');
    expect(screen.getByLabelText('From date')).toHaveValue('2026-10-21');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(fixture.router.state.location.search).toEqual({ size: 20 }));
    await waitFor(() => expect(fixture.adapter).toHaveBeenCalledTimes(7));
    expect(fixture.adapter.mock.calls[6]?.[0].params).toEqual({ page: 0, size: 20 });
  });

  it('keeps /transactions signed out and never preloads private history', async () => {
    const fixture = renderTransactions([], {
      initial: { version: 1, epoch: '10000000-0000-4000-8000-000000000001', mode: 'signed-out' },
    });
    await screen.findByRole('heading', { name: 'Sign in' });
    await act(() => fixture.router.preloadRoute({ to: '/transactions' }));
    expect(fixture.router.state.location.pathname).toBe('/transactions');
    expect(screen.queryByRole('heading', { name: 'Transactions' })).not.toBeInTheDocument();
    expect(fixture.adapter).not.toHaveBeenCalled();
  });

  it('waits for session restoration before requesting history', async () => {
    let release: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      successReply(transactionPage),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh') {
        markStarted();
        await pending;
      }
      return adapter(config);
    };
    renderTransactions([], { adapter: delayed });
    try {
      await started;
      expect(adapter.mock.calls.some(([config]) => config.url === MY_TRANSACTIONS_PATH)).toBe(
        false,
      );
      expect(screen.queryByRole('region', { name: 'Transaction history' })).not.toBeInTheDocument();
    } finally {
      release();
    }
    await screen.findByText('1 transaction');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Transfer sent')).toBeInTheDocument();
    expect(screen.getByLabelText('Sent: 50,000 VND')).toBeVisible();
    expect(
      adapter.mock.calls.filter(([config]) => config.url === MY_TRANSACTIONS_PATH),
    ).toHaveLength(1);
  });

  it('shows loading until history arrives and marks the navigation active', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      successReply(transactionPage),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === MY_TRANSACTIONS_PATH) await pending;
      return adapter(config);
    };
    const fixture = renderTransactions([], { adapter: delayed });
    try {
      await screen.findByRole('heading', { name: 'Loading transactions…' });
      expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    } finally {
      release();
    }
    await screen.findByText('1 transaction');
    expect(screen.getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(fixture.router.state.location.pathname).toBe('/transactions');
  });

  it('shows a real empty result without inventing pending payments', async () => {
    renderTransactions([
      csrfReply(),
      successReply(testSession),
      successReply({ ...transactionPage, content: [], totalElements: 0, totalPages: 0 }),
    ]);
    await screen.findByRole('heading', { name: 'No transactions yet' });
    expect(screen.queryByText('Payment pending')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('retries a failed GET explicitly without exposing raw server details', async () => {
    const fixture = renderTransactions([
      csrfReply(),
      successReply(testSession),
      new AxiosError('private history details', 'ERR_NETWORK'),
      successReply(transactionPage),
    ]);
    await screen.findByText('Unable to load transactions');
    expect(screen.queryByText(/private history details/)).not.toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('1 transaction');
    expect(fixture.adapter).toHaveBeenCalledTimes(4);
  });

  it('distinguishes a missing wallet from an empty history', async () => {
    renderTransactions([
      csrfReply(),
      successReply(testSession),
      errorReply('WALLET_NOT_FOUND', 404),
    ]);
    await screen.findByText('Wallet not found');
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
  });

  it('rejects malformed money without displaying a successful empty state', async () => {
    renderTransactions([
      csrfReply(),
      successReply(testSession),
      successReply({
        ...transactionPage,
        content: transactionPage.content.map((row) => ({ ...row, amount: 1.5 })),
      }),
    ]);
    await screen.findByText('Unable to load transactions');
    expect(screen.getByText(/could not be displayed reliably/)).toBeInTheDocument();
    expect(screen.queryByText('1 transaction')).not.toBeInTheDocument();
    expect(screen.queryByText('No transactions yet')).not.toBeInTheDocument();
  });

  it('hides the previous result when a background read fails', async () => {
    const fixture = renderTransactions([
      csrfReply(),
      successReply(testSession),
      successReply(transactionPage),
      errorReply('INTERNAL_SERVER_ERROR', 500),
    ]);
    await screen.findByText('1 transaction');
    await act(() => fixture.client.invalidateQueries({ queryKey: ['private'] }));
    await screen.findByText('Unable to load transactions');
    expect(screen.queryByRole('region', { name: 'Transaction history' })).not.toBeInTheDocument();
  });

  it('removes private history after confirmed sign out while preserving the URL', async () => {
    const fixture = renderTransactions([
      csrfReply(),
      successReply(testSession),
      successReply(transactionPage),
      csrfReply(),
      successReply(),
    ]);
    await screen.findByText('1 transaction');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign out?' });
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in' });
    await waitFor(() => expect(fixture.controller.getSnapshot().status).toBe('anonymous'));
    expect(screen.queryByRole('region', { name: 'Transaction history' })).not.toBeInTheDocument();
    expect(fixture.router.state.location.pathname).toBe('/transactions');
    expect(fixture.client.getQueryCache().getAll()).toHaveLength(0);
  });
});
