import { sameAccess, type SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { normalizeApiError } from '@/shared/api/api-error';
import { parseVndMinorUnits } from '@/shared/lib/vnd';
import type { createTransferApi } from '../api/transfer-api';
import {
  idempotencyKeySchema,
  TRANSFER_REJECTION_STATUS,
  transferRequestSchema,
  type TransferLookup,
  type TransferResponse,
} from '../api/transfer-schemas';
import type { TransferReview } from './transfer-draft';
import type { TransferMarker, TransferMarkerStore } from './transfer-marker';
import { matchesTransferReview, recoverTransferReview } from './transfer-recovery';

export type TransferSubmissionState =
  | { status: 'initializing' }
  | { status: 'idle'; draft?: TransferReview; focusInput?: boolean }
  | { status: 'submitting'; key: string }
  | { status: 'checking'; key: string }
  | {
      status: 'unknown';
      key: string;
      message: string;
      recovery?: TransferReview;
      readOnlyDetails?: TransferLookup['request'];
    }
  | { status: 'resume-review'; key: string; payload: TransferReview }
  | { status: 'blocked'; message: string }
  | {
      status: 'rejected';
      key: string;
      message: string;
      draft?: TransferReview;
      restartError?: string;
    }
  | {
      status: 'success';
      key: string;
      receipt: TransferResponse;
      request: { toEmail: string; amount: string; description: string | null };
      walletRefresh: 'updating' | 'ready' | 'error';
      legacyFractional: boolean;
      restartError?: string;
    };

export function createTransferSubmission(dependencies: {
  session: SessionController;
  access: SessionAccess;
  api: ReturnType<typeof createTransferApi>;
  markers: TransferMarkerStore;
  refreshWallet: () => Promise<void>;
  invalidateHistory?: () => Promise<void>;
  newKey?: () => string;
}) {
  const { session, access, api, markers, refreshWallet } = dependencies;
  const listeners = new Set<() => void>();
  let state: TransferSubmissionState = { status: 'initializing' };
  let active = false;
  let generation = 0;
  let request: AbortController | null = null;
  let unsubscribe: (() => void) | null = null;
  let intent: { key: string; payload: TransferReview } | null = null;
  let resumeBlocked = false;
  const current = (version: number) =>
    active && generation === version && sameAccess(session.getAccessIdentity(), access);
  function emit(next: TransferSubmissionState) {
    state = next;
    for (const listener of listeners) listener();
  }
  function clearKnown(marker: TransferMarker) {
    try {
      markers.clear(marker);
    } catch {
      // Keep a marker that could not be cleared; the next visit must check it.
    }
  }
  function verifyMarker(key: string) {
    const marker = markers.read();
    if (marker?.userId !== access.user.id || marker.idempotencyKey !== key)
      throw new Error('Transfer recovery changed.');
  }
  function loseSession() {
    generation += 1;
    request?.abort();
    intent = null;
    emit({
      status: 'blocked',
      message: 'Your session changed. Sign in again to check the transfer.',
    });
  }
  async function complete(
    key: string,
    receipt: TransferResponse,
    payload: { toEmail: string; amount: string; description: string | null },
    version: number,
    legacyFractional = false,
  ) {
    if (!current(version)) return;
    const historicalFraction =
      legacyFractional ||
      parseVndMinorUnits(receipt.amount) % 100n !== 0n ||
      parseVndMinorUnits(receipt.fromWalletBalance) % 100n !== 0n;
    clearKnown({ userId: access.user.id, idempotencyKey: key });
    emit({
      status: 'success',
      key,
      receipt,
      request: payload,
      walletRefresh: 'updating',
      legacyFractional: historicalFraction,
    });
    let walletRefresh: 'ready' | 'error' = 'ready';
    try {
      await dependencies.invalidateHistory?.();
    } catch {
      // History refresh cannot change a confirmed transfer outcome.
    }
    if (!current(version)) return;
    try {
      await refreshWallet();
    } catch {
      walletRefresh = 'error';
    }
    if (current(version) && state.status === 'success' && state.key === key)
      emit({ ...state, walletRefresh });
  }

  async function dispatch(key: string, payload: TransferReview, resuming: boolean) {
    const version = generation;
    request = new AbortController();
    intent = { key, payload };
    emit({ status: 'submitting', key });
    try {
      const receipt = await api.submit(payload, key, request.signal);
      await complete(key, receipt, payload, version);
    } catch (caught) {
      if (!current(version)) return;
      const error = normalizeApiError(caught);
      const rejected =
        error.kind === 'business' &&
        Object.entries(TRANSFER_REJECTION_STATUS).some(
          ([code, status]) => error.code === code && error.status === status,
        );
      // These validation errors precede registration only for this fresh POST.
      // A resume error cannot establish the outcome of the earlier request.
      const invalidInput =
        !resuming &&
        error.kind === 'business' &&
        error.status === 400 &&
        ['VALIDATION_ERROR', 'AMOUNT_OUT_OF_RANGE'].includes(error.code ?? '');
      if (rejected || invalidInput) {
        clearKnown({ userId: access.user.id, idempotencyKey: key });
        emit({ status: 'rejected', key, message: error.message, draft: payload });
      } else {
        if (
          ['IDEMPOTENCY_KEY_INVALID', 'IDEMPOTENCY_KEY_REUSED', 'LEGACY_FRACTIONAL_MONEY'].includes(
            error.code ?? '',
          )
        )
          resumeBlocked = true;
        emit({
          status: 'unknown',
          key,
          message: resumeBlocked
            ? 'We could not verify this transfer. Check its status or contact support before continuing.'
            : error.code === 'TOKEN_EXPIRED'
              ? 'Your session needs to be renewed. Check transfer status before continuing.'
              : error.message,
        });
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
    start() {
      if (active) return;
      active = true;
      if (!sameAccess(session.getAccessIdentity(), access)) {
        intent = null;
        emit({
          status: 'blocked',
          message: 'Your session changed. Sign in again before continuing.',
        });
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
                message: 'Check your previous transfer before starting another.',
              }
            : { status: 'idle' },
        );
      } catch {
        emit({
          status: 'blocked',
          message: 'Transfer recovery is unavailable. No new transfer can be sent.',
        });
      }
      unsubscribe = session.subscribe(() => {
        if (!sameAccess(session.getAccessIdentity(), access)) loseSession();
      });
    },
    stop() {
      active = false;
      generation += 1;
      request?.abort();
      request = null;
      unsubscribe?.();
      unsubscribe = null;
    },
    async submit(review: TransferReview) {
      if (!current(generation) || state.status !== 'idle') return;
      let payload: TransferReview;
      let key: string;
      try {
        payload = transferRequestSchema.parse(review);
        key = idempotencyKeySchema.parse((dependencies.newKey ?? (() => crypto.randomUUID()))());
        // Persistence is verified synchronously before dispatching any POST.
        markers.save({ userId: access.user.id, idempotencyKey: key });
      } catch {
        emit({
          status: 'blocked',
          message: 'Unable to prepare transfer recovery. No transfer was sent.',
        });
        return;
      }
      await dispatch(key, payload, false);
    },
    async checkStatus() {
      if (!current(generation) || state.status !== 'unknown') return;
      const { key } = state;
      const version = generation;
      request = new AbortController();
      emit({ status: 'checking', key });
      try {
        const result = await api.getRequest(key, request.signal);
        if (!current(version)) return;
        if (result.state === 'SUCCEEDED')
          await complete(key, result.result, result.request, version, result.legacyFractional);
        else if (result.state === 'REJECTED') {
          clearKnown({ userId: access.user.id, idempotencyKey: key });
          emit({
            status: 'rejected',
            key,
            message: result.error.message,
            draft: recoverTransferReview(result.request) ?? undefined,
          });
        } else {
          if (intent?.key === key && !matchesTransferReview(intent.payload, result.request))
            resumeBlocked = true;
          const recovery = resumeBlocked ? null : recoverTransferReview(result.request);
          if (recovery) {
            // Recheck the wallet before asking for another explicit confirmation.
            await refreshWallet();
            if (!current(version)) return;
            intent = { key, payload: recovery };
          }
          emit({
            status: 'unknown',
            key,
            message: recovery
              ? 'This transfer is pending. You can check again or review it before continuing.'
              : 'This transfer needs to be checked before you can send again. Contact support if it stays pending.',
            recovery: recovery ?? undefined,
            readOnlyDetails: recovery ? undefined : result.request,
          });
        }
      } catch (caught) {
        if (!current(version)) return;
        const error = normalizeApiError(caught);
        const missing = error.status === 404 && error.code === 'TRANSFER_REQUEST_NOT_FOUND';
        const recovery =
          missing && !resumeBlocked && intent?.key === key ? intent.payload : undefined;
        if (recovery) {
          try {
            await refreshWallet();
          } catch {
            if (current(version))
              emit({
                status: 'unknown',
                key,
                message:
                  'Your balance could not be updated. Check transfer status again before continuing.',
              });
            return;
          }
          if (!current(version)) return;
        }
        emit({
          status: 'unknown',
          key,
          message:
            missing && !intent
              ? 'Your transfer is not visible yet. Check again or contact support. Its details are no longer available in this tab, so it cannot be sent again here.'
              : error.message,
          recovery,
        });
      }
    },
    reviewResume() {
      if (!current(generation) || state.status !== 'unknown' || !state.recovery) return;
      emit({ status: 'resume-review', key: state.key, payload: { ...state.recovery } });
    },
    cancelResume() {
      if (!current(generation) || state.status !== 'resume-review') return;
      emit({
        status: 'unknown',
        key: state.key,
        message: 'No transfer was sent again. Check its status before starting another.',
        recovery: state.payload,
      });
    },
    async resume() {
      if (!current(generation) || state.status !== 'resume-review' || resumeBlocked) return;
      const { key, payload } = state;
      try {
        verifyMarker(key);
      } catch {
        emit({
          status: 'unknown',
          key,
          message:
            'Transfer recovery changed. Check its status or contact support before continuing.',
        });
        return;
      }
      await dispatch(key, transferRequestSchema.parse(payload), true);
    },
    newTransfer() {
      if (!current(generation) || (state.status !== 'success' && state.status !== 'rejected'))
        return;
      try {
        // Never replace an unresolved or different marker, even after a terminal result.
        markers.clear({ userId: access.user.id, idempotencyKey: state.key });
        if (markers.read()) throw new Error('An unresolved transfer remains.');
      } catch {
        emit({
          ...state,
          restartError: 'Unable to prepare another transfer. Check your wallet or contact support.',
        });
        return;
      }
      const draft = state.status === 'rejected' ? state.draft : undefined;
      generation += 1;
      intent = null;
      resumeBlocked = false;
      emit({ status: 'idle', draft, focusInput: true });
    },
  };
}
