import { z } from 'zod';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import { ApiError } from '@/shared/api/api-error';
import { transferRequestSchema } from './transfer-schemas';

export const RECIPIENT_LOOKUP_PATH = '/api/v1/transfer/recipient';
const recipientSchema = z.object({ exists: z.boolean() });

export function createRecipientApi(privateApi: PrivateApiFactory, access: SessionAccess) {
  const api = privateApi(access);
  return async (email: string, signal: AbortSignal) => {
    const parsed = transferRequestSchema.shape.toEmail.safeParse(email);
    if (!parsed.success) throw new ApiError('client');
    const result = await api.request(
      {
        method: 'GET',
        path: RECIPIENT_LOOKUP_PATH,
        params: { email: parsed.data },
        signal,
      },
      recipientSchema,
    );
    return result.exists;
  };
}
