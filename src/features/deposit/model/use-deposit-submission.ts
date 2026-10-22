import { useEffect, useState, useSyncExternalStore } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { createDepositApi } from '../api/deposit-api';
import type { DepositGatewayConfig } from '../api/payment-url';
import { createDepositMarkerStore } from './deposit-marker';
import { createDepositSubmission } from './deposit-submission';

export function useDepositSubmission(options: {
  session: SessionController;
  access: SessionAccess;
  privateApi: PrivateApiFactory;
  gateway: DepositGatewayConfig;
}) {
  const navigate = useNavigate();
  const [api] = useState(() =>
    createDepositApi(options.privateApi, options.access, options.gateway),
  );
  const mutation = useMutation({
    mutationKey: [
      'deposit',
      options.access.epoch,
      options.access.user.id,
      options.access.user.role,
    ],
    mutationFn: (intent: { amount: number; key: string; signal?: AbortSignal }) =>
      api.submit({ amount: intent.amount }, intent.key, intent.signal),
    retry: false,
    networkMode: 'always',
    gcTime: 0,
  });
  const [operation] = useState(() =>
    createDepositSubmission({
      ...options,
      api: {
        submit: (payload, key, signal) =>
          mutation.mutateAsync({ amount: payload.amount, key, signal }),
        getRequest: api.getRequest,
      },
      markers: createDepositMarkerStore(),
      openPayment: (url) => window.location.assign(url),
      openResult: (orderId) => navigate({ to: '/payment/result', search: { orderId } }),
    }),
  );
  useEffect(() => {
    operation.start();
    return operation.stop;
  }, [operation]);
  const state = useSyncExternalStore(operation.subscribe, operation.getSnapshot);
  return { state, operation };
}
