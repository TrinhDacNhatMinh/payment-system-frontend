import { z } from 'zod';

import type { SessionController } from '@/features/auth/model/session-controller';
import { idempotencyKeySchema } from '@/shared/api/idempotency-key';
import { apiIdSchema } from '@/shared/api/scalar-schemas';

export const DEPOSIT_MARKER_KEY = 'payment-system.deposit-request';
const markerSchema = z
  .object({ userId: apiIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict();
export type DepositMarker = z.infer<typeof markerSchema>;

export function createDepositMarkerStore(
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = () => window.sessionStorage,
) {
  function read(): DepositMarker | null {
    const value = storage().getItem(DEPOSIT_MARKER_KEY);
    return value === null ? null : markerSchema.parse(JSON.parse(value));
  }
  function clearAll() {
    storage().removeItem(DEPOSIT_MARKER_KEY);
    if (storage().getItem(DEPOSIT_MARKER_KEY) !== null) throw new Error('Marker cleanup failed.');
  }
  return {
    read,
    clearAll,
    ensureOwner(userId: number) {
      const marker = read();
      if (marker && marker.userId !== userId) clearAll();
    },
    save(marker: DepositMarker) {
      const value = markerSchema.parse(marker);
      if (read()) throw new Error('An existing top-up must be checked first.');
      storage().setItem(DEPOSIT_MARKER_KEY, JSON.stringify(value));
      const stored = read();
      if (stored?.userId !== value.userId || stored.idempotencyKey !== value.idempotencyKey)
        throw new Error('Marker persistence failed.');
    },
    clear(marker: DepositMarker) {
      const stored = read();
      if (!stored) return;
      if (stored.userId !== marker.userId || stored.idempotencyKey !== marker.idempotencyKey)
        throw new Error('A different top-up is recorded.');
      clearAll();
    },
  };
}

export type DepositMarkerStore = ReturnType<typeof createDepositMarkerStore>;

export function bindDepositMarkerCleanup(session: SessionController, markers: DepositMarkerStore) {
  const synchronize = () => {
    const state = session.getSnapshot();
    try {
      if (state.status === 'authenticated') markers.ensureOwner(state.user.id);
      else if (['anonymous', 'signing-out', 'logout-pending'].includes(state.status))
        markers.clearAll();
    } catch {
      // Storage failure must block preparation of a later POST.
    }
  };
  const unsubscribe = session.subscribe(synchronize);
  synchronize();
  return unsubscribe;
}
