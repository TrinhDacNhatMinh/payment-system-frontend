import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import { ApiError } from '@/shared/api/api-error';
import { parseVndMinorUnits } from '@/shared/lib/vnd';
import {
  idempotencyKeySchema,
  transferLookupSchema,
  transferRequestSchema,
  transferResponseSchema,
  type TransferRequest,
} from './transfer-schemas';

function parseKey(value: string) {
  const key = idempotencyKeySchema.safeParse(value);
  if (!key.success) throw new ApiError('client');
  return key.data;
}

// The caller supplies an existing reviewed intent/key. Generating or persisting
// keys, resuming an intent and deciding when to submit belong to later items.
export function createTransferApi(privateApi: PrivateApiFactory, access: SessionAccess) {
  const api = privateApi(access);
  return {
    async submit(request: TransferRequest, idempotencyKey: string, signal?: AbortSignal) {
      const key = parseKey(idempotencyKey);
      const payload = transferRequestSchema.safeParse(request);
      if (!payload.success) throw new ApiError('client');
      const receipt = await api.request(
        {
          method: 'POST',
          path: '/api/v1/transfer',
          data: payload.data,
          idempotencyKey: key,
          signal,
        },
        transferResponseSchema,
      );
      if (parseVndMinorUnits(receipt.amount) !== parseVndMinorUnits(payload.data.amount))
        throw new ApiError('protocol');
      return receipt;
    },
    async getRequest(idempotencyKey: string, signal?: AbortSignal) {
      const key = parseKey(idempotencyKey);
      const result = await api.request(
        { method: 'GET', path: `/api/v1/transfer/requests/${key}`, signal },
        transferLookupSchema,
      );
      if (result.idempotencyKey !== key) throw new ApiError('protocol');
      return result;
    },
  };
}
