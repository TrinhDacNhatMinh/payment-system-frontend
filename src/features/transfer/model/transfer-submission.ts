import { sameAccess, type SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { normalizeApiError } from '@/shared/api/api-error';
import { parseVndMinorUnits } from '@/shared/lib/vnd';
import type { createTransferApi } from '../api/transfer-api';
import {
  idempotencyKeySchema,
  TRANSFER_REJECTION_STATUS,
  transferRequestSchema,
  type TransferResponse,
} from '../api/transfer-schemas';
import type { TransferReview } from './transfer-draft';
import type { TransferMarker, TransferMarkerStore } from './transfer-marker';

export type TransferSubmissionState =
  | { status: 'initializing' }
  | { status: 'idle' }
  | { status: 'submitting'; key: string }
  | { status: 'checking'; key: string }
  | { status: 'unknown'; key: string; message: string }
  | { status: 'blocked'; message: string }
  | { status: 'rejected'; key: string; message: string }
  | {
      status: 'success';
      key: string;
      receipt: TransferResponse;
      request: { toEmail: string; amount: string; description: string | null };
      walletRefresh: 'updating' | 'ready' | 'error';
      legacyFractional: boolean;
    };

export function createTransferSubmission(dependencies: {
  session: SessionController;
  access: SessionAccess;
  api: ReturnType<typeof createTransferApi>;
  markers: TransferMarkerStore;
  refreshWallet: () => Promise<void>;
  newKey?: () => string;
}) {
  const { session, access, api, markers, refreshWallet } = dependencies;
  const listeners = new Set<() => void>();
  let state: TransferSubmissionState = { status: 'initializing' };
  let active = false;
  let generation = 0;
  let request: AbortController | null = null;
  let unsubscribe: (() => void) | null = null;
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
      await refreshWallet();
    } catch {
      walletRefresh = 'error';
    }
    if (current(version) && state.status === 'success' && state.key === key)
      emit({ ...state, walletRefresh });
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
        if (!sameAccess(session.getAccessIdentity(), access)) {
          generation += 1;
          request?.abort();
          emit({
            status: 'blocked',
            message: 'Your session changed. Sign in again to check the transfer.',
          });
        }
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
      const version = generation;
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
      request = new AbortController();
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
        if (rejected) {
          clearKnown({ userId: access.user.id, idempotencyKey: key });
          emit({ status: 'rejected', key, message: error.message });
        } else emit({ status: 'unknown', key, message: error.message });
      }
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
          emit({ status: 'rejected', key, message: result.error.message });
        } else
          emit({
            status: 'unknown',
            key,
            message: 'The transfer is pending. Check again before starting another.',
          });
      } catch (caught) {
        if (current(version))
          emit({ status: 'unknown', key, message: normalizeApiError(caught).message });
      }
    },
  };
}
