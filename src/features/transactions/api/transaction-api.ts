import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import { ApiError } from '@/shared/api/api-error';
import {
  transactionFiltersSchema,
  transactionPageSchema,
  type TransactionFiltersInput,
} from './transaction-schemas';

export const MY_TRANSACTIONS_PATH = '/api/v1/transactions';

export function transactionReadRequest(filters: TransactionFiltersInput = {}) {
  const parsed = transactionFiltersSchema.safeParse(filters);
  if (!parsed.success) throw new ApiError('client');
  const params = parsed.data;
  return {
    request: { path: MY_TRANSACTIONS_PATH, params },
    schema: transactionPageSchema.refine(
      (result) => result.page === params.page && result.size === params.size,
    ),
  };
}

export function createTransactionApi(privateApi: PrivateApiFactory, access: SessionAccess) {
  const api = privateApi(access);
  return {
    async getHistory(filters: TransactionFiltersInput = {}, signal?: AbortSignal) {
      const { request, schema } = transactionReadRequest(filters);
      return api.request({ ...request, method: 'GET', signal }, schema);
    },
  };
}
