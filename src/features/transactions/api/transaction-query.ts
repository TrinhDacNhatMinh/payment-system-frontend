import { privateQueryOptions } from '@/features/auth/api/private-query';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import type { ApiTransport } from '@/shared/api/http-client';
import { transactionReadRequest } from './transaction-api';
import type { TransactionFiltersInput } from './transaction-schemas';

export function transactionQueryOptions(options: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
  filters?: TransactionFiltersInput;
}) {
  const { session, access, api, filters } = options;
  const { request, schema } = transactionReadRequest(filters);
  return {
    ...privateQueryOptions({ session, access, api, key: ['transactions'], request, schema }),
    refetchInterval: false as const,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    // Avoid retaining history after its final observer has gone away.
    gcTime: 0,
  };
}
