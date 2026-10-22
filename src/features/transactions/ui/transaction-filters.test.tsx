import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_TRANSACTION_FILTERS } from '../model/transaction-search';
import { TransactionFilters } from './transaction-filters';

function renderFilters() {
  const apply = vi.fn(async () => undefined);
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <TransactionFilters initialValues={EMPTY_TRANSACTION_FILTERS} apply={apply} />
    </ConfigProvider>,
  );
  return apply;
}

describe('transaction filter form', () => {
  it('keeps edits as a draft until Apply', async () => {
    const apply = renderFilters();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-22' } });
    fireEvent.blur(screen.getByLabelText('From date'));
    expect(apply).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(apply).toHaveBeenCalledWith({
        ...EMPTY_TRANSACTION_FILTERS,
        fromDate: '2026-10-22',
      }),
    );
  });

  it('blocks reversed dates, focuses the error and clears it after correction', async () => {
    const apply = renderFilters();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-23' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-22' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('The end date must be on or after the start date.');
    await waitFor(() => expect(screen.getByLabelText('To date')).toHaveFocus());
    expect(apply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-24' } });
    await waitFor(() =>
      expect(
        screen.queryByText('The end date must be on or after the start date.'),
      ).not.toBeInTheDocument(),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it('resets an invalid draft and applies empty filters', async () => {
    const apply = renderFilters();
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-10-23' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-10-22' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reset' }));
    expect(apply).toHaveBeenCalledWith(EMPTY_TRANSACTION_FILTERS);
    expect(screen.getByLabelText('From date')).toHaveValue('');
    expect(screen.getByLabelText('To date')).toHaveValue('');
    expect(
      screen.queryByText('The end date must be on or after the start date.'),
    ).not.toBeInTheDocument();
  });
});
