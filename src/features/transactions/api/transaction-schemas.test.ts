import { describe, expect, it } from 'vitest';

import { transaction, transactionPage } from './transaction-fixture.test-support';
import {
  transactionFiltersSchema,
  transactionPageSchema,
  transactionResponseSchema,
} from './transaction-schemas';

describe('transaction boundary schemas', () => {
  it('defaults API pagination and preserves inclusive timestamp precision', () => {
    expect(transactionFiltersSchema.parse({})).toEqual({ page: 0, size: 10 });
    const filters = {
      type: 'TRANSFER_OUT',
      status: 'SUCCESS',
      fromDate: '2026-10-22T00:00:00',
      toDate: '2026-10-22T23:59:59.999999',
      page: 1,
      size: 20,
    };
    expect(transactionFiltersSchema.parse(filters)).toEqual(filters);
    expect(transactionFiltersSchema.parse({ fromDate: filters.fromDate })).toMatchObject({
      fromDate: filters.fromDate,
    });
  });

  it.each([
    { page: -1 },
    { page: 1.5 },
    { page: 2_147_483_648 },
    { page: '1' },
    { size: 0 },
    { size: 101 },
    { type: 'WITHDRAWAL' },
    { status: 'All' },
    { userId: 2 },
    { fromDate: '2026-02-30T00:00:00' },
    { fromDate: '2026-10-22T00:00:00Z' },
    { toDate: '2026-10-22T00:00:00+07:00' },
    { fromDate: '2026-10-23T00:00:00', toDate: '2026-10-22T23:59:59.999999' },
    { fromDate: '2026-10-22T00:00:00.1', toDate: '2026-10-22T00:00:00.09' },
  ])('rejects invalid selectors without coercion: %j', (filters) => {
    expect(transactionFiltersSchema.safeParse(filters).success).toBe(false);
  });

  it('accepts equivalent timestamp bounds and preserves response values without a timezone', () => {
    expect(
      transactionFiltersSchema.safeParse({
        fromDate: '2026-10-22T00:00:00.000',
        toDate: '2026-10-22T00:00:00',
      }).success,
    ).toBe(true);
    expect(transactionResponseSchema.parse(transaction)).toEqual(transaction);
    expect(
      transactionResponseSchema.parse({ ...transaction, amount: 0, description: null }),
    ).toMatchObject({ amount: 0, description: null });
  });

  it.each([-1, 0.5, '50000', Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    'rejects unsupported money %s instead of rounding',
    (amount) => {
      expect(transactionResponseSchema.safeParse({ ...transaction, amount }).success).toBe(false);
    },
  );

  it('accepts empty and out-of-range pages without fabricating rows', () => {
    expect(transactionPageSchema.parse(transactionPage)).toEqual(transactionPage);
    expect(
      transactionPageSchema.safeParse({
        ...transactionPage,
        content: [],
        totalElements: 0,
        totalPages: 0,
      }).success,
    ).toBe(true);
    expect(
      transactionPageSchema.safeParse({ ...transactionPage, content: [], page: 5 }).success,
    ).toBe(true);
  });

  it.each([
    { totalPages: 2 },
    { page: 1 },
    { size: 0 },
    { totalElements: Number.MAX_SAFE_INTEGER + 1 },
    { content: [transaction, transaction] },
    { content: [{ ...transaction, status: 'UNKNOWN' }] },
    { content: [{ ...transaction, createdAt: '2026-02-30T14:35:01' }] },
  ])('rejects malformed records or page metadata: %j', (changes) => {
    expect(transactionPageSchema.safeParse({ ...transactionPage, ...changes }).success).toBe(false);
  });
});
