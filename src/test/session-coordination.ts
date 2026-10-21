import type {
  AuthControl,
  ControlRead,
  SessionCoordination,
} from '@/features/auth/model/session-control';

// Deterministic two-lock/two-tab test double, never imported by production code.
export function createSessionCoordinationHub(initial: ControlRead = null) {
  let control = initial;
  let epochs = 0;
  let authTail: Promise<unknown> = Promise.resolve();
  let controlTail: Promise<unknown> = Promise.resolve();
  const peers = new Map<symbol, () => void>();
  const writes: AuthControl[] = [];

  function connect(): SessionCoordination {
    const id = Symbol('tab');
    return {
      read: () => control,
      newEpoch: () => `00000000-0000-4000-8000-${String(++epochs).padStart(12, '0')}`,
      change(update) {
        const work = controlTail.then(() => {
          const next = update(control);
          if (next && JSON.stringify(next) !== JSON.stringify(control)) {
            control = next;
            writes.push(next);
            for (const [peer, notify] of peers) if (peer !== id) queueMicrotask(notify);
          }
          return next;
        });
        controlTail = work.catch(() => undefined);
        return work;
      },
      runExclusive<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
        const work = authTail.then(() => {
          signal.throwIfAborted();
          return operation();
        });
        authTail = work.catch(() => undefined);
        return work;
      },
      subscribe(listener) {
        const notify = () => listener();
        peers.set(id, notify);
        return () => {
          if (peers.get(id) === notify) peers.delete(id);
        };
      },
    };
  }

  return { connect, writes, read: () => control };
}
