import { z } from 'zod';

import { apiIdSchema, vietnamDateTimeSchema } from '@/shared/api/scalar-schemas';

export const walletResponseSchema = z.object({
  id: apiIdSchema,
  userId: apiIdSchema,
  // The wallet endpoint still returns a JSON number. Do not convert this to
  // exact minor units or use it to establish a transfer outcome. Fail closed
  // on unsafe magnitudes rather than display a rounded large balance.
  balance: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal('VND'),
  updatedAt: vietnamDateTimeSchema,
});

export type WalletResponse = z.infer<typeof walletResponseSchema>;
