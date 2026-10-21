import { ApiError, normalizeApiError } from '@/shared/api/api-error';
import type { ApiTransport } from '@/shared/api/http-client';
import {
  sameAccess,
  SessionAccessError,
  waitForSessionWork,
  type SessionAccess,
} from '../model/session-access';
import type { SessionController } from '../model/session-controller';

export type PrivateApiFactory = (access: SessionAccess) => ApiTransport;

export function createPrivateApi(
  transport: ApiTransport,
  session: SessionController,
): PrivateApiFactory {
  return (access) => ({
    async request(options, schema) {
      const checkAccess = () => {
        if (options.signal?.aborted) throw new ApiError('cancelled');
        if (!sameAccess(session.getAccessIdentity(), access)) throw new SessionAccessError();
      };
      if (options.signal?.aborted) throw new ApiError('cancelled');
      if (!session.isCurrentEpoch(access.epoch)) throw new SessionAccessError();
      let sentToken = await waitForSessionWork(session.ensureAccessToken(), options.signal);
      checkAccess();
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          checkAccess();
          const result = await transport.request(options, schema);
          checkAccess();
          return result;
        } catch (error) {
          if (options.signal?.aborted) throw new ApiError('cancelled');
          if (!session.isCurrentEpoch(access.epoch)) throw new SessionAccessError();
          const current = session.getAccessIdentity();
          if (current && !sameAccess(current, access)) throw new SessionAccessError();
          const failure = normalizeApiError(error);
          const expired =
            failure.kind === 'business' &&
            failure.status === 401 &&
            failure.code === 'TOKEN_EXPIRED';
          const read = options.method === 'GET' || options.method === 'HEAD';
          if (expired && read && attempt === 0) {
            sentToken = await waitForSessionWork(
              session.renewAccessToken(sentToken),
              options.signal,
            );
            checkAccess();
            continue;
          }
          const invalid =
            failure.kind === 'business' &&
            failure.status === 401 &&
            ['TOKEN_INVALID', 'UNAUTHORIZED'].includes(failure.code ?? '');
          const locked =
            failure.kind === 'business' &&
            failure.status === 403 &&
            failure.code === 'ACCOUNT_LOCKED';
          if (invalid || locked || (expired && read))
            await session.rejectAccess(access.epoch, sentToken, locked);
          throw failure;
        }
      }
      throw new ApiError('client');
    },
  });
}
