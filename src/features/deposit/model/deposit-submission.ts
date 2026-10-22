import { sameAccess, type SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { ApiError, normalizeApiError } from '@/shared/api/api-error';
import { idempotencyKeySchema } from '@/shared/api/idempotency-key';
import type { createDepositApi } from '../api/deposit-api';
import {
  depositOrderSchema,
  depositRequestSchema,
  type DepositOrder,
} from '../api/deposit-schemas';
import {
  createPaymentUrlPolicy,
  validatePaymentUrl,
  type DepositGatewayConfig,
} from '../api/payment-url';
import type { DepositMarkerStore } from './deposit-marker';

export type DepositSubmissionState =
  | { status: 'initializing' }
  | { status: 'idle'; draftAmount?: string; message?: string }
  | { status: 'submitting'; key: string }
  | { status: 'checking'; key: string }
  | { status: 'unknown'; key: string; message: string; canResume?: boolean }
  | { status: 'resume-review'; key: string; amount: number }
  | { status: 'known'; orderId: string }
  | { status: 'blocked'; message: string };

export function createDepositSubmission(deps: {
  session: SessionController;
  access: SessionAccess;
  api: Pick<ReturnType<typeof createDepositApi>, 'submit' | 'getRequest'>;
  markers: DepositMarkerStore;
  gateway: DepositGatewayConfig;
  openPayment: (url: string) => void;
  openResult: (orderId: string) => void | Promise<void>;
  newKey?: () => string;
}) {
  const { session, access, api, markers } = deps;
  const policy = createPaymentUrlPolicy(deps.gateway);
  const listeners = new Set<() => void>();
  let state: DepositSubmissionState = { status: 'initializing' };
  let active = false;
  let generation = 0;
  let request: AbortController | null = null;
  let unsubscribe: (() => void) | null = null;
  let intent: { key: string; amount: number } | null = null;
  let resumeBlocked = false;
  const current = (version: number) =>
    active && version === generation && sameAccess(session.getAccessIdentity(), access);
  function emit(next: DepositSubmissionState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function verifyMarker(key: string) {
    const marker = markers.read();
    if (marker?.userId !== access.user.id || marker.idempotencyKey !== key)
      throw new Error('Top-up recovery changed.');
  }
  async function acceptOrder(value: DepositOrder, key: string, version: number, redirect: boolean) {
    if (!current(version)) return;
    const parsed = depositOrderSchema.safeParse(value);
    if (!parsed.success) throw new ApiError('protocol');
    const order = parsed.data;
    if (order.idempotencyKey !== key || (intent?.key === key && intent.amount !== order.amount))
      throw new ApiError('protocol');
    validatePaymentUrl(order, policy);
    verifyMarker(key);
    if (order.status !== 'PENDING') {
      try {
        markers.clear({ userId: access.user.id, idempotencyKey: key });
      } catch {
        // Keep confirmed order navigation available, but never overwrite an uncleared marker.
      }
    }
    emit({ status: 'known', orderId: order.orderId });
    if (!current(version)) return;
    try {
      if (redirect && order.canContinuePayment && order.paymentUrl)
        deps.openPayment(order.paymentUrl);
      else await deps.openResult(order.orderId);
    } catch {
      // Keep the confirmed order link available if browser/router navigation fails.
    }
  }
  async function dispatch(key: string, amount: number, resuming: boolean) {
    const version = generation;
    request = new AbortController();
    intent = { key, amount };
    emit({ status: 'submitting', key });
    try {
      const order = await api.submit({ amount }, key, request.signal);
      await acceptOrder(order, key, version, true);
    } catch (caught) {
      if (!current(version)) return;
      const error = normalizeApiError(caught);
      const invalid =
        !resuming &&
        error.kind === 'business' &&
        error.status === 400 &&
        ['VALIDATION_ERROR', 'AMOUNT_OUT_OF_RANGE'].includes(error.code ?? '');
      if (invalid) {
        try {
          markers.clear({ userId: access.user.id, idempotencyKey: key });
          if (!markers.read()) {
            intent = null;
            emit({ status: 'idle', draftAmount: String(amount), message: error.message });
            return;
          }
        } catch {
          // An uncertain marker must be checked before another request.
        }
      }
      if (
        error.kind === 'protocol' ||
        ['DEPOSIT_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID', 'LEGACY_FRACTIONAL_MONEY'].includes(
          error.code ?? '',
        )
      )
        resumeBlocked = true;
      emit({
        status: 'unknown',
        key,
        message: 'Your top-up could not be confirmed. Check the request before trying again.',
      });
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (active) return;
      active = true;
      intent = null;
      if (!current(generation)) {
        emit({ status: 'blocked', message: 'Sign in again to check your top-up.' });
        return;
      }
      try {
        markers.ensureOwner(access.user.id);
        const marker = markers.read();
        emit(
          marker
            ? {
                status: 'unknown',
                key: marker.idempotencyKey,
                message: 'Check your previous top-up before starting another.',
              }
            : { status: 'idle' },
        );
      } catch {
        emit({
          status: 'blocked',
          message: 'Top-up recovery is unavailable. No payment request can be sent.',
        });
      }
      unsubscribe = session.subscribe(() => {
        if (!sameAccess(session.getAccessIdentity(), access)) {
          generation += 1;
          request?.abort();
          intent = null;
          emit({ status: 'blocked', message: 'Sign in again to check your top-up.' });
        }
      });
    },
    stop() {
      active = false;
      generation += 1;
      request?.abort();
      request = null;
      intent = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    async submit(amount: number) {
      if (!current(generation) || state.status !== 'idle') return;
      let key: string;
      try {
        depositRequestSchema.parse({ amount });
        key = idempotencyKeySchema.parse((deps.newKey ?? (() => crypto.randomUUID()))());
        markers.save({ userId: access.user.id, idempotencyKey: key });
      } catch {
        emit({
          status: 'blocked',
          message: 'Unable to prepare top-up recovery. No payment request was sent.',
        });
        return;
      }
      await dispatch(key, amount, false);
    },
    async checkStatus() {
      if (!current(generation) || state.status !== 'unknown') return;
      const { key } = state;
      const version = generation;
      request = new AbortController();
      emit({ status: 'checking', key });
      try {
        verifyMarker(key);
        await acceptOrder(await api.getRequest(key, request.signal), key, version, false);
      } catch (caught) {
        if (!current(version)) return;
        const error = normalizeApiError(caught);
        const missing =
          error.kind === 'business' &&
          error.status === 404 &&
          error.code === 'DEPOSIT_REQUEST_NOT_FOUND';
        emit({
          status: 'unknown',
          key,
          message: missing
            ? 'Your top-up is not visible yet. Check again before starting another.'
            : 'Your top-up could not be checked. Try checking again shortly.',
          canResume: missing && !resumeBlocked && intent?.key === key,
        });
      }
    },
    reviewResume() {
      if (
        !current(generation) ||
        state.status !== 'unknown' ||
        !state.canResume ||
        !intent ||
        intent.key !== state.key
      )
        return;
      emit({ status: 'resume-review', key: intent.key, amount: intent.amount });
    },
    cancelResume() {
      if (!current(generation) || state.status !== 'resume-review') return;
      emit({
        status: 'unknown',
        key: state.key,
        message: 'No new request was sent. Check your top-up before continuing.',
        canResume: true,
      });
    },
    async resume() {
      if (!current(generation) || state.status !== 'resume-review' || resumeBlocked) return;
      const { key, amount } = state;
      try {
        verifyMarker(key);
      } catch {
        emit({
          status: 'blocked',
          message: 'Top-up recovery changed. Check your payment with support before continuing.',
        });
        return;
      }
      await dispatch(key, amount, true);
    },
  };
}
