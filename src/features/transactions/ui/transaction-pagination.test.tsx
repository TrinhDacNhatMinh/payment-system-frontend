import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TransactionPagination } from './transaction-pagination';

let mobile = false;
beforeEach(() => {
  mobile = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(max-width: 700px)' && mobile,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: () => true,
  }));
});

describe('transaction pagination controls', () => {
  it.each([false, true])('moves to the next page with mobile=%s', async (isMobile) => {
    mobile = isMobile;
    const change = vi.fn(async () => undefined);
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <TransactionPagination page={1} total={25} busy={false} change={change} />
      </ConfigProvider>,
    );
    expect(screen.getByRole('navigation', { name: 'Transaction pagination' })).toBeVisible();
    await userEvent.setup().click(screen.getByTitle('Next Page'));
    expect(change).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Rows per page')).not.toBeInTheDocument();
  });

  it('disables page controls during a read', async () => {
    const change = vi.fn(async () => undefined);
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <TransactionPagination page={1} total={25} busy change={change} />
      </ConfigProvider>,
    );
    await userEvent.setup().click(screen.getByTitle('Next Page'));
    expect(change).not.toHaveBeenCalled();
  });
});
