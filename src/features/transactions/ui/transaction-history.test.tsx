import { act, render, screen, within } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transaction } from '../api/transaction-fixture.test-support';
import { transactionResponseSchema } from '../api/transaction-schemas';
import { TransactionHistory } from './transaction-history';

let width = 1200;
let mediaQueries: Map<string, MediaQueryList>;

beforeEach(() => {
  width = 1200;
  mediaQueries = new Map();
  vi.stubGlobal('matchMedia', (query: string) => {
    const existing = mediaQueries.get(query);
    if (existing) return existing;
    const events = new EventTarget();
    const media = {
      get matches() {
        const max = /max-width:\s*(\d+)px/.exec(query);
        return max ? width <= Number(max[1]) : false;
      },
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    } as MediaQueryList;
    mediaQueries.set(query, media);
    return media;
  });
});

const transactions = [
  transactionResponseSchema.parse(transaction),
  transactionResponseSchema.parse({
    ...transaction,
    id: 18,
    type: 'DEPOSIT',
    status: 'PENDING',
    description: null,
  }),
  transactionResponseSchema.parse({
    ...transaction,
    id: 19,
    type: 'TRANSFER_IN',
    status: 'FAILED',
    description: 'Long message '.repeat(20),
  }),
];

function renderHistory() {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <TransactionHistory transactions={transactions} />
    </ConfigProvider>,
  );
}

describe('responsive transaction records', () => {
  it('shows all desktop columns, real records and unchanged server order', () => {
    renderHistory();
    const table = screen.getByRole('table');
    for (const name of ['Type', 'Amount', 'Status', 'Description', 'Date']) {
      expect(within(table).getByRole('columnheader', { name })).toBeInTheDocument();
    }
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Transfer sent'),
      expect.stringContaining('Top up'),
      expect.stringContaining('Transfer received'),
    ]);
    expect(screen.getByLabelText('Sent: 50,000 VND')).toHaveTextContent('−50,000 VND');
    expect(screen.getByLabelText('Pending incoming amount: 50,000 VND')).toHaveTextContent(
      '+50,000 VND',
    );
    expect(screen.getByLabelText('Pending incoming amount: 50,000 VND')).toHaveClass(
      'transaction-amount-neutral',
    );
    expect(screen.getByLabelText('Amount: 50,000 VND')).toHaveTextContent('50,000 VND');
    expect(screen.getByLabelText('No description')).toHaveTextContent('—');
    expect(screen.getAllByText('14:35 22/10/2026')).toHaveLength(3);
    expect(screen.queryByRole('list', { name: 'Transactions' })).not.toBeInTheDocument();
    expect(screen.queryByText(/GMT|SUCCESS|TRANSFER_OUT/)).not.toBeInTheDocument();
  });

  it.each([320, 390, 700])('shows readable cards instead of the table at %spx', (viewport) => {
    width = viewport;
    renderHistory();
    const list = screen.getByRole('list', { name: 'Transactions' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    const [sent, pending, failed] = cards;
    if (!sent || !pending || !failed) throw new Error('Expected all three transaction cards.');
    expect(within(sent).getByRole('heading', { name: 'Transfer sent' })).toBeVisible();
    expect(within(sent).getByText('Completed')).toBeVisible();
    expect(within(pending).getByText('Pending')).toBeVisible();
    expect(within(failed).getByText('Failed')).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('No description')).not.toBeInTheDocument();
    const time = within(sent).getByText('14:35 22/10/2026');
    expect(time).toHaveAttribute('datetime', transaction.createdAt);
    expect(within(failed).getByText('Long message '.repeat(20).trim())).toBeVisible();
  });

  it('switches presentation across 700px without changing or duplicating records', () => {
    renderHistory();
    expect(screen.getByRole('table')).toBeInTheDocument();
    act(() => {
      width = 700;
      for (const media of mediaQueries.values()) media.dispatchEvent(new Event('change'));
    });
    expect(screen.getByRole('list', { name: 'Transactions' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    act(() => {
      width = 701;
      for (const media of mediaQueries.values()) media.dispatchEvent(new Event('change'));
    });
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Transactions' })).not.toBeInTheDocument();
    expect(screen.getAllByText('14:35 22/10/2026')).toHaveLength(3);
  });
});
