import { z } from 'zod';

import {
  transactionStatusSchema,
  transactionTypeSchema,
  type TransactionFilters,
} from '../api/transaction-schemas';

export const TRANSACTIONS_PAGE_SIZE = 10;

const optionalDate = z
  .string()
  .refine((value) => value === '' || z.iso.date().safeParse(value).success, {
    message: 'Enter a valid date.',
  });

export const transactionFilterDraftSchema = z
  .object({
    type: z.union([z.literal(''), transactionTypeSchema]),
    status: z.union([z.literal(''), transactionStatusSchema]),
    fromDate: optionalDate,
    toDate: optionalDate,
  })
  .refine(({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate, {
    message: 'The end date must be on or after the start date.',
    path: ['toDate'],
  });

export type TransactionFilterDraft = z.infer<typeof transactionFilterDraftSchema>;
export const EMPTY_TRANSACTION_FILTERS: TransactionFilterDraft = {
  type: '',
  status: '',
  fromDate: '',
  toDate: '',
};

export type TransactionSearch = {
  type?: z.infer<typeof transactionTypeSchema>;
  status?: z.infer<typeof transactionStatusSchema>;
  fromDate?: string;
  toDate?: string;
  page?: number;
  invalid?: true;
};

const searchInteger = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^[1-9]\d*$/)
      .transform(Number),
  ])
  .pipe(z.number().int().positive());

const searchSchema = z
  .object({
    type: transactionTypeSchema.optional(),
    status: transactionStatusSchema.optional(),
    fromDate: z.iso.date().optional(),
    toDate: z.iso.date().optional(),
    page: searchInteger.pipe(z.number().max(2_147_483_648)).optional(),
  })
  .refine(({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate);

// Invalid known selectors block the read until reset. Unrelated search fields
// are stripped and can never select another owner or an arbitrary API path.
export function parseTransactionSearch(value: unknown): TransactionSearch {
  const result = searchSchema.safeParse(value);
  if (!result.success) return { invalid: true };
  const { page, ...filters } = result.data;
  return {
    ...filters,
    ...(page && page !== 1 ? { page } : {}),
  };
}

export function transactionFilterDraft(search: TransactionSearch): TransactionFilterDraft {
  return {
    type: search.type ?? '',
    status: search.status ?? '',
    fromDate: search.fromDate ?? '',
    toDate: search.toDate ?? '',
  };
}

export function appliedTransactionFilters(search: TransactionSearch): TransactionFilters {
  if (search.invalid) throw new RangeError('Invalid transaction search.');
  return {
    type: search.type,
    status: search.status,
    fromDate: search.fromDate ? `${search.fromDate}T00:00:00` : undefined,
    // PostgreSQL timestamps have microsecond precision. Do not use .999999999:
    // rounding nanoseconds on the server could include the next day.
    toDate: search.toDate ? `${search.toDate}T23:59:59.999999` : undefined,
    page: (search.page ?? 1) - 1,
    size: TRANSACTIONS_PAGE_SIZE,
  };
}

export function transactionSearchFromDraft(draft: TransactionFilterDraft) {
  const value = transactionFilterDraftSchema.parse(draft);
  return parseTransactionSearch({
    type: value.type || undefined,
    status: value.status || undefined,
    fromDate: value.fromDate || undefined,
    toDate: value.toDate || undefined,
  });
}

export function transactionPageSearch(search: TransactionSearch, page: number) {
  if (search.invalid) throw new RangeError('Invalid transaction search.');
  const next = parseTransactionSearch({
    ...search,
    page,
  });
  if (next.invalid) throw new RangeError('Invalid transaction page.');
  return next;
}
