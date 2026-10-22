import { sameAccess, type SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { ApiError, normalizeApiError } from '@/shared/api/api-error';
import { depositOrderSchema, type DepositOrder } from '../api/deposit-schemas';
import {
  createPaymentUrlPolicy,
  validatePaymentUrl,
  type DepositGatewayConfig,
} from '../api/payment-url';
import type { DepositMarkerStore } from './deposit-marker';

export type DepositResultState =
  | { status: 'loading' }
  | { status: 'blocked' }
  | { status: 'unavailable'; message: string; busy: boolean }
  | {
      status: 'pending';
      order: DepositOrder;
      busy: boolean;
      automatic: boolean;
      canStartNew: boolean;
      message?: string;
    }
  | {
      status: 'success';
      order: DepositOrder;
      wallet: 'updating' | 'ready' | 'error';
      canStartNew: boolean;
    }
  | { status: 'failed'; order: DepositOrder; canStartNew: boolean };

const POLL_INTERVAL = 2_000;
const VISIBLE_BUDGET = 60_000;
const MAX_AUTO_READS = 30;

export function createDepositResult(deps: {
  session: SessionController;
  access: SessionAccess;
  orderId: string;
  readOrder: (id: string, signal: AbortSignal) => Promise<DepositOrder>;
  markers: DepositMarkerStore;
  refreshWallet: () => Promise<void>;
  gateway: DepositGatewayConfig | null;
  openPayment: (url: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const { session, access } = deps;
  const policy = deps.gateway ? createPaymentUrlPolicy(deps.gateway) : null;
  const now = deps.now ?? (() => performance.now());
  const setTimer = deps.setTimer ?? setTimeout;
  const clearTimer = deps.clearTimer ?? clearTimeout;
  const listeners = new Set<() => void>();
  let state: DepositResultState = { status: 'loading' };
  let active = false;
  let generation = 0;
  let request: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let visible = true;
  let online = true;
  let visibleSince: number | null = null;
  let elapsed = 0;
  let automatic = true;
  let reads = 0;
  let flight = false;
  const current = (version: number) =>
    active && generation === version && sameAccess(session.getAccessIdentity(), access);
  function emit(next: DepositResultState) {
    state = next;
    listeners.forEach((listener) => listener());
  }
  function clearTick() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function usedBudget() {
    return elapsed + (visibleSince === null ? 0 : Math.max(0, now() - visibleSince));
  }
  function stopAutomatic() {
    automatic = false;
    clearTick();
    if (state.status === 'pending') emit({ ...state, automatic: false });
  }
  function schedule(delay = POLL_INTERVAL) {
    clearTick();
    if (!active || !automatic || !visible) return;
    const remaining = VISIBLE_BUDGET - usedBudget();
    if (remaining <= 0 || reads >= MAX_AUTO_READS) {
      stopAutomatic();
      return;
    }
    timer = setTimer(
      () => {
        timer = null;
        if (!current(generation)) return;
        if (usedBudget() >= VISIBLE_BUDGET || reads >= MAX_AUTO_READS) {
          stopAutomatic();
          return;
        }
        if (online && !flight) void load('automatic');
        else schedule();
      },
      Math.min(delay, remaining),
    );
  }
  function clearKnownOrderMarker(order: DepositOrder) {
    try {
      const marker = deps.markers.read();
      if (!marker) return true;
      if (marker.userId !== access.user.id || marker.idempotencyKey !== order.idempotencyKey)
        return false;
      deps.markers.clear(marker);
      return deps.markers.read() === null;
    } catch {
      return false;
    }
  }
  async function updateWallet(version: number) {
    if (!current(version)) return;
    try {
      await deps.refreshWallet();
      if (current(version) && state.status === 'success') emit({ ...state, wallet: 'ready' });
    } catch {
      if (current(version) && state.status === 'success') emit({ ...state, wallet: 'error' });
    }
  }
  async function load(mode: 'automatic' | 'manual' | 'continue') {
    const version = generation;
    if (!current(version) || flight || !visible || !online) return;
    if (state.status === 'success' || state.status === 'failed' || state.status === 'blocked')
      return;
    if (mode === 'automatic') {
      if (!automatic || usedBudget() >= VISIBLE_BUDGET || reads >= MAX_AUTO_READS) {
        stopAutomatic();
        return;
      }
      reads += 1;
    } else stopAutomatic();
    clearTick();
    flight = true;
    request = new AbortController();
    if (state.status === 'pending' || state.status === 'unavailable')
      emit({ ...state, busy: true });
    try {
      const result = await deps.readOrder(deps.orderId, request.signal);
      if (!current(version)) return;
      const parsed = depositOrderSchema.safeParse(result);
      if (!parsed.success || parsed.data.orderId !== deps.orderId) throw new ApiError('protocol');
      const order = parsed.data;
      if (policy) validatePaymentUrl(order, policy);
      if (order.status === 'SUCCESS') {
        stopAutomatic();
        emit({
          status: 'success',
          order,
          wallet: 'updating',
          canStartNew: clearKnownOrderMarker(order),
        });
        await updateWallet(version);
      } else if (order.status === 'FAILED') {
        stopAutomatic();
        emit({ status: 'failed', order, canStartNew: clearKnownOrderMarker(order) });
      } else {
        // A known order remains accessible by its result URL; it need not block a new intent.
        const canStartNew = clearKnownOrderMarker(order);
        const canAuto = automatic && usedBudget() < VISIBLE_BUDGET && reads < MAX_AUTO_READS;
        emit({
          status: 'pending',
          order,
          busy: false,
          automatic: canAuto,
          canStartNew,
          message: !canStartNew ? 'Check your previous top-up before starting another.' : undefined,
        });
        if (mode === 'continue' && policy && order.canContinuePayment && order.paymentUrl) {
          if (current(version) && visible && online) deps.openPayment(order.paymentUrl);
        }
      }
    } catch (caught) {
      if (!current(version)) return;
      stopAutomatic();
      const error = normalizeApiError(caught);
      emit({
        status: 'unavailable',
        busy: false,
        message:
          error.status === 404
            ? 'This top-up is unavailable or belongs to another account. Its payment result is not confirmed.'
            : 'We could not check this payment. Check its status again before starting another top-up.',
      });
    } finally {
      if (current(version)) {
        flight = false;
        request = null;
        schedule();
      }
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
    start(isVisible: boolean, isOnline: boolean) {
      if (active) return;
      active = true;
      visible = isVisible;
      online = isOnline;
      visibleSince = visible ? now() : null;
      if (!current(generation)) {
        emit({ status: 'blocked' });
        return;
      }
      if (!online) {
        emit({
          status: 'unavailable',
          busy: false,
          message: 'You are offline. Reconnect to check your payment status.',
        });
      }
      unsubscribe = session.subscribe(() => {
        if (!sameAccess(session.getAccessIdentity(), access)) {
          generation += 1;
          request?.abort();
          clearTick();
          emit({ status: 'blocked' });
        }
      });
      schedule(0);
    },
    stop() {
      if (visibleSince !== null) elapsed += Math.max(0, now() - visibleSince);
      visibleSince = null;
      active = false;
      generation += 1;
      request?.abort();
      request = null;
      flight = false;
      clearTick();
      unsubscribe?.();
      unsubscribe = null;
    },
    wake(isVisible: boolean, isOnline: boolean) {
      if (!current(generation)) return;
      if (visibleSince !== null) elapsed += Math.max(0, now() - visibleSince);
      visible = isVisible;
      online = isOnline;
      visibleSince = visible ? now() : null;
      schedule(reads === 0 ? 0 : POLL_INTERVAL);
    },
    checkStatus: () => load('manual'),
    continuePayment: () => load('continue'),
    async retryWallet() {
      if (!current(generation) || state.status !== 'success' || state.wallet !== 'error') return;
      emit({ ...state, wallet: 'updating' });
      await updateWallet(generation);
    },
  };
}
