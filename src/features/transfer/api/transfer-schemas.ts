import { z } from 'zod';

import { ApiError } from '@/shared/api/api-error';
import { apiIdSchema, vietnamDateTimeSchema } from '@/shared/api/scalar-schemas';
import { isVndDecimal, MIN_TRANSFER_MINOR_UNITS, parseVndMinorUnits } from '@/shared/lib/vnd';

const emailSchema = z.string().email().max(255);
const descriptionSchema = z.string().max(255).nullable();

export const idempotencyKeySchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  .transform((value) => value.toLowerCase());

export const transferAmountSchema = z
  .string()
  .refine((value) => isVndDecimal(value) && parseVndMinorUnits(value) >= MIN_TRANSFER_MINOR_UNITS, {
    message: 'Enter an amount from 1,000 to 9,999,999,999,999,999.99 VND with at most 2 decimals.',
  });

// Input normalization happens before review/dispatch. No description trimming,
// number coercion, lowercasing of email or rounding of money is allowed.
export const transferRequestSchema = z
  .object({
    toEmail: z.string().trim().pipe(emailSchema),
    amount: transferAmountSchema,
    description: descriptionSchema.optional().default(null),
  })
  .strict();

const canonicalRequestSchema = z.object({
  toEmail: emailSchema,
  amount: transferAmountSchema,
  description: descriptionSchema,
});

export const transferResponseSchema = z.object({
  transactionId: apiIdSchema,
  fromWalletBalance: z.string().refine(isVndDecimal),
  amount: transferAmountSchema,
  status: z.literal('SUCCESS'),
  createdAt: vietnamDateTimeSchema,
});

const rejectionStatus = {
  SELF_TRANSFER_NOT_ALLOWED: 400,
  RECIPIENT_NOT_FOUND: 404,
  RECIPIENT_LOCKED: 400,
  WALLET_NOT_FOUND: 404,
  WALLET_INSUFFICIENT_BALANCE: 400,
} as const;

const rejectionSchema = z
  .object({
    httpStatus: z.number().int(),
    code: z.enum([
      'SELF_TRANSFER_NOT_ALLOWED',
      'RECIPIENT_NOT_FOUND',
      'RECIPIENT_LOCKED',
      'WALLET_NOT_FOUND',
      'WALLET_INSUFFICIENT_BALANCE',
    ]),
    message: z.string(),
  })
  .refine((error) => error.httpStatus === rejectionStatus[error.code])
  .transform((error) => ({
    ...error,
    message: new ApiError('business', { status: error.httpStatus, code: error.code }).message,
  }));

const lookupFields = {
  idempotencyKey: idempotencyKeySchema,
  request: canonicalRequestSchema,
};

export const transferLookupSchema = z
  .discriminatedUnion('state', [
    z.object({
      ...lookupFields,
      state: z.literal('PENDING'),
      result: z.null(),
      error: z.null(),
    }),
    z.object({
      ...lookupFields,
      state: z.literal('SUCCEEDED'),
      result: transferResponseSchema,
      error: z.null(),
    }),
    z.object({
      ...lookupFields,
      state: z.literal('REJECTED'),
      result: z.null(),
      error: rejectionSchema,
    }),
  ])
  .refine(
    (lookup) =>
      lookup.state !== 'SUCCEEDED' ||
      (isVndDecimal(lookup.result.amount) &&
        isVndDecimal(lookup.request.amount) &&
        parseVndMinorUnits(lookup.result.amount) === parseVndMinorUnits(lookup.request.amount)),
    { message: 'The receipt amount does not match the request.' },
  );

export type TransferRequest = z.input<typeof transferRequestSchema>;
export type TransferResponse = z.infer<typeof transferResponseSchema>;
export type TransferLookup = z.infer<typeof transferLookupSchema>;
