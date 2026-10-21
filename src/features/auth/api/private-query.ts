import { queryOptions, type QueryFunctionContext, type QueryKey } from '@tanstack/react-query';
import type { z } from 'zod';

import type { ApiTransport, RequestOptions } from '@/shared/api/http-client';
import { sameAccess, SessionAccessError, type SessionAccess } from '../model/session-access';
import type { SessionController } from '../model/session-controller';

export function privateQueryOptions<T>(options: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
  key: QueryKey;
  request: Omit<RequestOptions, 'signal' | 'data' | 'csrfToken' | 'method'> & { method?: 'GET' };
  schema: z.ZodType<T>;
}) {
  const { session, access, api, key, request, schema } = options;
  async function load({ signal }: QueryFunctionContext) {
    // fetchQuery/ensureQueryData can bypass enabled, so guard execution too.
    if (!session.isCurrentEpoch(access.epoch)) throw new SessionAccessError();
    const result = await api.request({ ...request, method: 'GET', signal }, schema);
    if (!sameAccess(session.getAccessIdentity(), access)) throw new SessionAccessError();
    return result;
  }
  return queryOptions({
    // Include all data selectors, without clients, schemas or credentials.
    queryKey: [
      'private',
      access.epoch,
      access.user.id,
      access.user.role,
      request.path,
      request.params ?? {},
      ...key,
    ],
    enabled: () => sameAccess(session.getAccessIdentity(), access),
    retry: false,
    staleTime: 0,
    queryFn: load,
  });
}
