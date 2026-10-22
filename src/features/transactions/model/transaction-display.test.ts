import { describe, expect, it } from 'vitest';

import { transaction } from '../api/transaction-fixture.test-support';
import { transactionResponseSchema } from '../api/transaction-schemas';
import { formatTransactionTime, transactionDisplay } from './transaction-display';

describe('transaction presentation', () => {
  it.each([
    ['DEPOSIT', 'Top up', '+50,000 VND', 'Received: 50,000 VND'],
    ['TRANSFER_IN', 'Transfer received', '+50,000 VND', 'Received: 50,000 VND'],
    ['TRANSFER_OUT', 'Transfer sent', '−50,000 VND', 'Sent: 50,000 VND'],
  ] as const)('presents a completed %s with its direction', (type, label, amount, amountLabel) => {
    const item = transactionDisplay(transactionResponseSchema.parse({ ...transaction, type }));
    expect(item).toMatchObject({ type: label, statusLabel: 'Completed', amount, amountLabel });
  });

  it.each([
    ['DEPOSIT', '+50,000 VND', 'Pending incoming amount: 50,000 VND'],
    ['TRANSFER_IN', '+50,000 VND', 'Pending incoming amount: 50,000 VND'],
    ['TRANSFER_OUT', '−50,000 VND', 'Pending outgoing amount: 50,000 VND'],
  ] as const)('shows pending %s direction without success colors', (type, amount, amountLabel) => {
    const item = transactionDisplay(
      transactionResponseSchema.parse({ ...transaction, type, status: 'PENDING' }),
    );
    expect(item).toMatchObject({ amount, amountLabel, direction: 'neutral', statusLabel: 'Pending' });
  });

  it('keeps failed amounts unsigned and neutral', () => {
    const item = transactionDisplay(
      transactionResponseSchema.parse({ ...transaction, status: 'FAILED' }),
    );
    expect(item).toMatchObject({
      amount: '50,000 VND',
      amountLabel: 'Amount: 50,000 VND',
      direction: 'neutral',
      statusLabel: 'Failed',
    });
  });

  it('keeps every digit of a safe large amount and preserves meaningful whitespace', () => {
    const item = transactionDisplay(
      transactionResponseSchema.parse({
        ...transaction,
        amount: Number.MAX_SAFE_INTEGER,
        description: '  Rent\nOctober  ',
      }),
    );
    expect(item.amount).toBe('−9,007,199,254,740,991 VND');
    expect(item.description).toBe('  Rent\nOctober  ');
  });

  it.each([null, '', '   \n '])('treats %j as an absent description', (description) => {
    expect(
      transactionDisplay(transactionResponseSchema.parse({ ...transaction, description }))
        .description,
    ).toBeNull();
  });

  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 1])('never rounds unsupported money %s', (amount) => {
    const valid = transactionResponseSchema.parse(transaction);
    expect(() => transactionDisplay({ ...valid, amount })).toThrow(RangeError);
  });

  it('formats local clock fields without timezone conversion or rounding up seconds', () => {
    expect(formatTransactionTime('2026-10-22T00:05:59.999999')).toBe('00:05 22/10/2026');
    expect(formatTransactionTime('2026-01-02T23:59:59')).toBe('23:59 02/01/2026');
    expect(() => formatTransactionTime('2026-10-22T00:05:59Z')).toThrow();
    expect(() => formatTransactionTime('2026-02-30T00:05:59')).toThrow();
  });
});
