import {
  AUTH_CHANNEL_NAME,
  AUTH_CONTROL_KEY,
  AUTH_CONTROL_LOCK_NAME,
  AUTH_LOCK_NAME,
  CoordinationUnavailableError,
  authControlSchema,
  parseAuthControl,
  type SessionCoordination,
} from './session-control';

export function createBrowserSessionCoordination(): SessionCoordination {
  let channel: BroadcastChannel | null = null;

  function assertAvailable() {
    if (
      !window.isSecureContext ||
      !navigator.locks ||
      typeof BroadcastChannel === 'undefined' ||
      typeof crypto.randomUUID !== 'function'
    ) {
      throw new CoordinationUnavailableError();
    }
  }

  function read() {
    try {
      assertAvailable();
      return parseAuthControl(window.localStorage.getItem(AUTH_CONTROL_KEY));
    } catch {
      throw new CoordinationUnavailableError();
    }
  }

  return {
    read,
    newEpoch: () => {
      assertAvailable();
      return crypto.randomUUID();
    },
    async change(update) {
      assertAvailable();
      try {
        // No network or auth-lock acquisition inside this short critical section.
        // All marker writers use it, making epoch comparison + write atomic.
        return await navigator.locks.request(AUTH_CONTROL_LOCK_NAME, async () => {
          const current = read();
          const next = update(current);
          if (next === null) return null;
          const validated = authControlSchema.parse(next);
          if (JSON.stringify(current) !== JSON.stringify(validated)) {
            if (!channel) throw new CoordinationUnavailableError();
            window.localStorage.setItem(AUTH_CONTROL_KEY, JSON.stringify(validated));
            channel.postMessage({ type: 'control-changed' });
          }
          return validated;
        });
      } catch {
        throw new CoordinationUnavailableError();
      }
    },
    async runExclusive(operation, signal) {
      assertAvailable();
      let entered = false;
      try {
        return await navigator.locks.request(
          AUTH_LOCK_NAME,
          { mode: 'exclusive', signal },
          async () => {
            entered = true;
            signal.throwIfAborted();
            return operation();
          },
        );
      } catch (error) {
        if (!entered && !signal.aborted) throw new CoordinationUnavailableError();
        throw error;
      }
    },
    subscribe(listener) {
      assertAvailable();
      read();
      try {
        channel = new BroadcastChannel(AUTH_CHANNEL_NAME);
      } catch {
        throw new CoordinationUnavailableError();
      }
      const currentChannel = channel;
      const onStorage = (event: StorageEvent) => {
        if (event.key === AUTH_CONTROL_KEY || event.key === null) listener();
      };
      const onMessage = (event: MessageEvent<unknown>) => {
        if (
          event.data &&
          typeof event.data === 'object' &&
          'type' in event.data &&
          event.data.type === 'control-changed'
        )
          listener();
      };
      window.addEventListener('storage', onStorage);
      currentChannel.addEventListener('message', onMessage);
      return () => {
        window.removeEventListener('storage', onStorage);
        currentChannel.removeEventListener('message', onMessage);
        currentChannel.close();
        if (channel === currentChannel) channel = null;
      };
    },
  };
}
