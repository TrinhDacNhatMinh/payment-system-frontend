import { ApiError } from '@/shared/api/api-error';
import type { SessionController } from './session-controller';

export type SessionAccess = NonNullable<ReturnType<SessionController['getAccessIdentity']>>;
export type SessionRole = SessionAccess['user']['role'];

export class SessionAccessError extends ApiError {
  constructor(readonly denied = false) {
    super('business', {
      status: denied ? 403 : 401,
      code: denied ? 'ACCESS_DENIED' : 'UNAUTHORIZED',
    });
    this.name = 'SessionAccessError';
  }
}

export function sameAccess(current: SessionAccess | null, expected: SessionAccess) {
  return (
    current?.epoch === expected.epoch &&
    current.user.id === expected.user.id &&
    current.user.role === expected.user.role
  );
}

// Cancelling one reader must not cancel the shared refresh used by other readers.
export function waitForSessionWork<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ApiError('cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    if (signal.aborted) onAbort();
  });
}

async function waitForRestoration(session: SessionController, signal?: AbortSignal) {
  if (session.getSnapshot().status !== 'restoring') return;
  let unsubscribe: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    const check = () => {
      if (session.getSnapshot().status !== 'restoring') resolve();
    };
    unsubscribe = session.subscribe(check);
    check();
  });
  try {
    await waitForSessionWork(ready, signal);
  } finally {
    unsubscribe();
  }
}

export async function requireSessionAccess(
  session: SessionController | null,
  options: { signal?: AbortSignal; preload?: boolean; roles?: readonly SessionRole[] } = {},
): Promise<SessionAccess> {
  if (!session) throw new SessionAccessError();
  if (options.signal?.aborted) throw new ApiError('cancelled');
  if (!options.preload) {
    await waitForRestoration(session, options.signal);
    const state = session.getSnapshot();
    if (state.status !== 'authenticated' || !session.isCurrentEpoch(state.epoch))
      throw new SessionAccessError();
    await waitForSessionWork(session.ensureAccessToken(), options.signal);
  }
  const access = session.getAccessIdentity();
  if (!access) throw new SessionAccessError();
  if (options.roles && !options.roles.includes(access.user.role))
    throw new SessionAccessError(true);
  return access;
}
