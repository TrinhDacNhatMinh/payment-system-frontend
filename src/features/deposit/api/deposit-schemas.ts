import { z } from 'zod';

import { idempotencyKeySchema } from '@/shared/api/idempotency-key';
import { vietnamDateTimeSchema } from '@/shared/api/scalar-schemas';

export const MIN_DEPOSIT_AMOUNT = 10_000;
export const MAX_DEPOSIT_AMOUNT = 50_000_000;
const AMOUNT_MESSAGE = 'Enter a whole VND amount from 10,000 to 50,000,000.';

export const depositAmountSchema = z
  .number()
  .int()
  .min(MIN_DEPOSIT_AMOUNT, AMOUNT_MESSAGE)
  .max(MAX_DEPOSIT_AMOUNT, AMOUNT_MESSAGE);

// Form input remains text until its syntax and exact integer range are checked.
export const depositAmountInputSchema = z
  .string()
  .refine(
    (value) =>
      /^[0-9]{1,16}$/.test(value) &&
      BigInt(value) >= BigInt(MIN_DEPOSIT_AMOUNT) &&
      BigInt(value) <= BigInt(MAX_DEPOSIT_AMOUNT),
    AMOUNT_MESSAGE,
  )
  .transform((value) => Number(value));

export const depositRequestSchema = z.object({ amount: depositAmountSchema }).strict();
export const depositOrderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);

function localTimeOrder(value: string) {
  return `${value.slice(0, 19)}.${value.slice(20).padEnd(9, '0')}`;
}

// Lookup may return an older whole amount outside today's creation limits.
// Unsafe JSON numbers have already lost information and must not be formatted as exact money.
export const depositOrderSchema = z
  .object({
    orderId: depositOrderIdSchema,
    idempotencyKey: idempotencyKeySchema.nullable(),
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    currency: z.literal('VND'),
    status: z.enum(['PENDING', 'SUCCESS', 'FAILED']),
    createdAt: vietnamDateTimeSchema,
    paymentUrlExpiresAt: vietnamDateTimeSchema.nullable(),
    paidAt: vietnamDateTimeSchema.nullable(),
    canContinuePayment: z.boolean(),
    paymentUrl: z.string().min(1).nullable(),
  })
  .superRefine((order, context) => {
    const invalid = (message: string) => context.addIssue({ code: 'custom', message });
    if (order.canContinuePayment) {
      if (order.status !== 'PENDING' || !order.paymentUrl || !order.paymentUrlExpiresAt)
        invalid('A payable order must be pending and have a link and expiry.');
    } else if (order.paymentUrl !== null) {
      invalid('An unavailable payment link must be null.');
    }
    if (order.status !== 'SUCCESS' && order.paidAt !== null)
      invalid('Only a successful order can have a payment time.');
    if (
      order.paymentUrlExpiresAt !== null &&
      localTimeOrder(order.paymentUrlExpiresAt) <= localTimeOrder(order.createdAt)
    )
      invalid('Payment link expiry must follow creation.');
  });

export type DepositRequest = z.input<typeof depositRequestSchema>;
export type DepositOrder = z.output<typeof depositOrderSchema>;
