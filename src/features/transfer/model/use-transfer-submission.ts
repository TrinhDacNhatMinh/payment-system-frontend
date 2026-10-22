import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import {
  sameAccess,
  SessionAccessError,
  type SessionAccess,
} from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { walletQueryOptions } from '@/features/wallet/api/wallet-query';
import { invalidateTransactionHistory } from '@/features/transactions/api/transaction-invalidation';
import { createTransferApi } from '../api/transfer-api';
import type { TransferReview } from './transfer-draft';
import { createTransferMarkerStore } from './transfer-marker';
import { createTransferSubmission } from './transfer-submission';

// The containing flow is keyed by epoch/user/role, so these clients belong to one scope.
export function useTransferSubmission(options: {
  session: SessionController;
  access: SessionAccess;
  privateApi: PrivateApiFactory;
}) {
  const { session, access, privateApi } = options;
  const queryClient = useQueryClient();
  const [api] = useState(() => createTransferApi(privateApi, access));
  const mutation = useMutation({
    mutationKey: ['transfer', access.epoch, access.user.id, access.user.role],
    mutationFn: (intent: { payload: TransferReview; key: string; signal?: AbortSignal }) =>
      api.submit(intent.payload, intent.key, intent.signal),
    // Do not queue an offline money command for automatic execution on reconnect.
    networkMode: 'always',
    retry: false,
    gcTime: 0,
  });
  const [operation] = useState(() =>
    createTransferSubmission({
      session,
      access,
      api: {
        submit: (payload, key, signal) =>
          mutation.mutateAsync({
            payload: { ...payload, description: payload.description ?? null },
            key,
            signal,
          }),
        getRequest: api.getRequest,
      },
      markers: createTransferMarkerStore(),
      invalidateHistory: () =>
        invalidateTransactionHistory({ client: queryClient, session, access }),
      refreshWallet: async () => {
        const check = () => {
          if (!sameAccess(session.getAccessIdentity(), access)) throw new SessionAccessError();
        };
        check();
        const { queryKey } = walletQueryOptions({ session, access, api: privateApi(access) });
        // Discard any pre-transfer GET before requesting a fresh snapshot.
        await queryClient.cancelQueries({ queryKey, exact: true });
        check();
        await queryClient.invalidateQueries({ queryKey, exact: true }, { throwOnError: true });
        check();
      },
    }),
  );
  useEffect(() => {
    operation.start();
    return operation.stop;
  }, [operation]);
  const state = useSyncExternalStore(operation.subscribe, operation.getSnapshot);
  return {
    state,
    submit: operation.submit,
    checkStatus: operation.checkStatus,
    reviewResume: operation.reviewResume,
    cancelResume: operation.cancelResume,
    resume: operation.resume,
    newTransfer: operation.newTransfer,
  };
}
