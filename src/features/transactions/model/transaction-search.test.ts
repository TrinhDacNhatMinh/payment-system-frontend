import { describe, expect, it } from 'vitest';

import {
  appliedTransactionFilters,
  EMPTY_TRANSACTION_FILTERS,
  parseTransactionSearch,
  transactionFilterDraft,
  transactionFilterDraftSchema,
  transactionSearchFromDraft,
  transactionPageSearch,
} from './transaction-search';

describe('transaction filter URL contract', () => {
  it('changes page without dropping filters', () => {
    const search = {
      type: 'DEPOSIT' as const,
      status: 'SUCCESS' as const,
      page: 3,
      toDate: '2026-10-22',
    };
    expect(transactionPageSearch(search, 4)).toEqual({ ...search, page: 4 });
    expect(transactionPageSearch({ page: 2 }, 1)).toEqual({});
    expect(() => transactionPageSearch(search, -1)).toThrow();
  });

  it('normalizes defaults and excludes unknown owner, sort and redirect selectors', () => {
    expect(
      parseTransactionSearch({ page: '1', size: 10, userId: 99, sort: 'id', next: '/admin' }),
    ).toEqual({});
    expect(appliedTransactionFilters({})).toMatchObject({ page: 0, size: 10 });
    expect(transactionFilterDraft({})).toEqual(EMPTY_TRANSACTION_FILTERS);
  });

  it('keeps date-only URL values and sends both inclusive local bounds at microsecond precision', () => {
    const search = parseTransactionSearch({
      type: 'TRANSFER_IN',
      status: 'SUCCESS',
      fromDate: '2026-10-22',
      toDate: '2026-10-22',
      page: '3',
      size: '20',
    });
    expect(appliedTransactionFilters(search)).toEqual({
      type: 'TRANSFER_IN',
      status: 'SUCCESS',
      fromDate: '2026-10-22T00:00:00',
      toDate: '2026-10-22T23:59:59.999999',
      page: 2,
      size: 10,
    });
    expect(transactionFilterDraft(search)).toEqual({
      type: 'TRANSFER_IN',
      status: 'SUCCESS',
      fromDate: '2026-10-22',
      toDate: '2026-10-22',
    });
  });

  it.each([
    { type: 'WITHDRAWAL' },
    { status: 'All' },
    { page: 0 },
    { page: -1 },
    { page: 1.5 },
    { page: '2e2' },
    { page: 2_147_483_649 },
    { fromDate: '2026-02-30' },
    { fromDate: ['2026-10-22'] },
    { toDate: '2026-10-22T23:59:59' },
    { fromDate: '2026-10-23', toDate: '2026-10-22' },
  ])('blocks invalid URL selectors %j', (value) => {
    const search = parseTransactionSearch(value);
    expect(search).toEqual({ invalid: true });
    expect(() => appliedTransactionFilters(search)).toThrow();
  });

  it('supports either date independently and a valid leap day', () => {
    expect(
      appliedTransactionFilters(parseTransactionSearch({ toDate: '2028-02-29' })),
    ).toMatchObject({
      fromDate: undefined,
      toDate: '2028-02-29T23:59:59.999999',
    });
    expect(
      appliedTransactionFilters(parseTransactionSearch({ fromDate: '2026-10-22' })),
    ).toMatchObject({
      fromDate: '2026-10-22T00:00:00',
      toDate: undefined,
    });
  });

  it('ignores URL size and always requests ten rows', () => {
    for (const size of [20, 50, 100, 0, 'invalid']) {
      const search = parseTransactionSearch({ page: 2, size });
      expect(search).toEqual({ page: 2 });
      expect(appliedTransactionFilters(search).size).toBe(10);
    }
  });

  it('applies or resets at the first page', () => {
    expect(transactionSearchFromDraft({ ...EMPTY_TRANSACTION_FILTERS, type: 'DEPOSIT' })).toEqual({
      type: 'DEPOSIT',
    });
    expect(transactionSearchFromDraft(EMPTY_TRANSACTION_FILTERS)).toEqual({});
    expect(
      transactionFilterDraftSchema.safeParse({
        ...EMPTY_TRANSACTION_FILTERS,
        fromDate: '2026-10-23',
        toDate: '2026-10-22',
      }).success,
    ).toBe(false);
  });
});
