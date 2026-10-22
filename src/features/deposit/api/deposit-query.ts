import { queryOptions } from '@tanstack/react-query';

import type { SessionAccess } from '@/features/auth/model/session-access';
import type { createDepositOrderReader } from './deposit-api';

export function depositOrderQueryOptions(
  reader: ReturnType<typeof createDepositOrderReader>,
  access: SessionAccess,
  orderId: string,
) {
  return queryOptions({
    queryKey: ['private', access.epoch, access.user.id, access.user.role, 'deposit-order', orderId],
    queryFn: ({ signal }) => reader.getOrder(orderId, signal),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: 'always',
  });
}
