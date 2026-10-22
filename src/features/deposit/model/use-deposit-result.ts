import { useEffect, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import {
  sameAccess,
  SessionAccessError,
  type SessionAccess,
} from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { walletQueryOptions } from '@/features/wallet/api/wallet-query';
import { ApiError } from '@/shared/api/api-error';
import { createDepositOrderReader } from '../api/deposit-api';
import { depositOrderQueryOptions } from '../api/deposit-query';
import { parseDepositGatewayConfig } from './deposit-gateway-config';
import { createDepositMarkerStore } from './deposit-marker';
import { createDepositResult } from './deposit-result';

export function useDepositResult(options: {
  session: SessionController;
  access: SessionAccess;
  privateApi: PrivateApiFactory;
  orderId: string;
}) {
  const { session, access, privateApi, orderId } = options;
  const client = useQueryClient();
  const [gateway] = useState(() => parseDepositGatewayConfig(import.meta.env));
  const [reader] = useState(() => createDepositOrderReader(privateApi, access));
  const [queryKey] = useState(() => depositOrderQueryOptions(reader, access, orderId).queryKey);
  const [operation] = useState(() =>
    createDepositResult({
      session,
      access,
      orderId,
      gateway,
      markers: createDepositMarkerStore(),
      readOrder: async (id, signal) => {
        if (signal.aborted) throw new ApiError('cancelled');
        const query = depositOrderQueryOptions(reader, access, id);
        const abort = () => {
          void client.cancelQueries({ queryKey: query.queryKey, exact: true });
        };
        signal.addEventListener('abort', abort, { once: true });
        try {
          return await client.fetchQuery(query);
        } finally {
          signal.removeEventListener('abort', abort);
        }
      },
      refreshWallet: async () => {
        const check = () => {
          if (!sameAccess(session.getAccessIdentity(), access)) throw new SessionAccessError();
        };
        check();
        const wallet = walletQueryOptions({ session, access, api: privateApi(access) });
        await client.cancelQueries({ queryKey: wallet.queryKey, exact: true });
        check();
        await client.invalidateQueries({
          queryKey: wallet.queryKey,
          exact: true,
          refetchType: 'none',
        });
        check();
        await client.fetchQuery({ ...wallet, staleTime: 0, retry: false, networkMode: 'always' });
        check();
      },
      openPayment: (url) => window.location.assign(url),
    }),
  );
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible';
    const wake = () => operation.wake(visible(), navigator.onLine);
    operation.start(visible(), navigator.onLine);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('offline', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('offline', wake);
      operation.stop();
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    };
  }, [client, operation, queryKey]);
  const state = useSyncExternalStore(operation.subscribe, operation.getSnapshot);
  return { state, operation };
}
