import { z } from 'zod';

import type { SessionController } from '@/features/auth/model/session-controller';
import { apiIdSchema } from '@/shared/api/scalar-schemas';
import { idempotencyKeySchema } from '../api/transfer-schemas';

export const TRANSFER_MARKER_KEY = 'payment-system.transfer-request';
const markerSchema = z
  .object({ userId: apiIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict();
export type TransferMarker = z.infer<typeof markerSchema>;

export function createTransferMarkerStore(
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () => window.sessionStorage,
) {
  function read(): TransferMarker | null {
    const value = storage().getItem(TRANSFER_MARKER_KEY);
    return value === null ? null : markerSchema.parse(JSON.parse(value));
  }
  function clearAll() {
    storage().removeItem(TRANSFER_MARKER_KEY);
    if (storage().getItem(TRANSFER_MARKER_KEY) !== null) throw new Error('Marker cleanup failed.');
  }
  return {
    read,
    clearAll,
    ensureOwner(userId: number) {
      const marker = read();
      if (marker && marker.userId !== userId) clearAll();
    },
    save(marker: TransferMarker) {
      const value = markerSchema.parse(marker);
      if (read()) throw new Error('An existing transfer must be checked first.');
      storage().setItem(TRANSFER_MARKER_KEY, JSON.stringify(value));
      const stored = read();
      if (stored?.userId !== value.userId || stored.idempotencyKey !== value.idempotencyKey)
        throw new Error('Marker persistence failed.');
    },
    clear(marker: TransferMarker) {
      const stored = read();
      if (!stored) return;
      if (stored.userId !== marker.userId || stored.idempotencyKey !== marker.idempotencyKey)
        throw new Error('A different transfer is recorded.');
      clearAll();
    },
  };
}

export type TransferMarkerStore = ReturnType<typeof createTransferMarkerStore>;

// Mounted at app scope so logout also cleans this tab's marker outside /transfer.
export function bindTransferMarkerCleanup(
  session: SessionController,
  markers: TransferMarkerStore,
) {
  const synchronize = () => {
    const state = session.getSnapshot();
    try {
      if (state.status === 'authenticated') markers.ensureOwner(state.user.id);
      else if (['anonymous', 'signing-out', 'logout-pending'].includes(state.status))
        markers.clearAll();
    } catch {
      // Storage can be unavailable. A later transfer preparation fails closed.
    }
  };
  const unsubscribe = session.subscribe(synchronize);
  synchronize();
  return unsubscribe;
}
