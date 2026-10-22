import { z } from 'zod';

import { paymentOrderIdSchema } from '@/shared/api/payment-order-id';

const searchSchema = z.object({
  orderId: paymentOrderIdSchema.optional(),
  verification: z.enum(['invalid', 'unavailable']).optional(),
});
export type PaymentResultSearch = z.output<typeof searchSchema>;

// Unknown query fields never become a payment outcome, redirect or auth payload.
export function parsePaymentResultSearch(value: unknown): PaymentResultSearch {
  const result = searchSchema.safeParse(value);
  if (!result.success) return { verification: 'invalid' };
  if (result.data.verification) return { verification: result.data.verification };
  return result.data.orderId ? { orderId: result.data.orderId } : {};
}

export function getPaymentResultReturnTo(value: unknown) {
  const search = parsePaymentResultSearch(value);
  return search.orderId
    ? (`/payment/result?orderId=${encodeURIComponent(search.orderId)}` as const)
    : undefined;
}
