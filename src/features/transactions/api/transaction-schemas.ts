import { z } from 'zod';

import { apiIdSchema } from '@/shared/api/scalar-schemas';

export const transactionTypeSchema = z.enum(['DEPOSIT', 'TRANSFER_IN', 'TRANSFER_OUT']);
export const transactionStatusSchema = z.enum(['PENDING', 'SUCCESS', 'FAILED']);

// Validate syntax without assigning a timezone to the backend audit timestamp.
export const transactionDateTimeSchema = z.iso
  .datetime({ local: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/);

function comparableDateTime(value: string) {
  const [seconds, fraction = ''] = value.split('.');
  return `${seconds}.${fraction.padEnd(9, '0')}`;
}

// API page numbers are zero-based. URL/day-picker conversion belongs to I4-05.
export const transactionFiltersSchema = z
  .object({
    type: transactionTypeSchema.optional(),
    status: transactionStatusSchema.optional(),
    fromDate: transactionDateTimeSchema.optional(),
    toDate: transactionDateTimeSchema.optional(),
    page: z.number().int().min(0).max(2_147_483_647).default(0),
    size: z.number().int().min(1).max(100).default(10),
  })
  .strict()
  .refine(
    ({ fromDate, toDate }) =>
      !fromDate || !toDate || comparableDateTime(fromDate) <= comparableDateTime(toDate),
    { message: 'The start date must not follow the end date.', path: ['toDate'] },
  );

export const transactionResponseSchema = z.object({
  id: apiIdSchema,
  type: transactionTypeSchema,
  // No coercion or rounding: unsafe/legacy fractional amounts fail closed.
  amount: z.number().nonnegative().refine(Number.isSafeInteger),
  status: transactionStatusSchema,
  description: z.string().nullable(),
  createdAt: transactionDateTimeSchema,
});

export const transactionPageSchema = z
  .object({
    content: z.array(transactionResponseSchema),
    page: z.number().int().min(0).max(2_147_483_647),
    size: z.number().int().min(1).max(100),
    totalElements: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    totalPages: z.number().int().min(0).max(2_147_483_647),
  })
  .refine(
    ({ content, page, size, totalElements, totalPages }) =>
      totalPages === Math.ceil(totalElements / size) &&
      content.length <= size &&
      content.length <= totalElements &&
      (page < totalPages || content.length === 0) &&
      new Set(content.map(({ id }) => id)).size === content.length,
    { message: 'Invalid transaction pagination metadata.' },
  );

export type TransactionFiltersInput = z.input<typeof transactionFiltersSchema>;
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
export type TransactionPage = z.infer<typeof transactionPageSchema>;
