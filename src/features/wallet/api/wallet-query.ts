import { privateQueryOptions } from '@/features/auth/api/private-query';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import type { ApiTransport } from '@/shared/api/http-client';
import { MY_WALLET_PATH } from './wallet-api';
import { walletResponseSchema } from './wallet-schemas';

export function walletQueryOptions(options: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
}) {
  const { session, access, api } = options;
  return {
    ...privateQueryOptions({
      session,
      access,
      api,
      key: ['wallet'],
      request: { path: MY_WALLET_PATH },
      schema: walletResponseSchema.refine((wallet) => wallet.userId === access.user.id),
    }),
    // Temporary balance updates while the wallet page is visible.
    refetchInterval: 2_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
}
