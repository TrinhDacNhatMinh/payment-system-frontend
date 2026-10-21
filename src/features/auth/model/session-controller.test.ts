import type { AxiosAdapter } from 'axios';
import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHttpClients } from '@/shared/api/http-client';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionCoordinationHub } from '@/test/session-coordination';
import {
  CoordinationUnavailableError,
  type AuthControl,
  type SessionCoordination,
} from './session-control';
import { createSessionController, type SessionController } from './session-controller';

const session = {
  accessToken: 'private-access',
  tokenType: 'Bearer',
  expiresIn: 100,
  user: { id: 1, email: 'member@example.com', role: 'USER' },
};
const csrf = () => successReply({ headerName: 'X-XSRF-TOKEN', token: 'masked-csrf' });
const active: AuthControl = {
  version: 1,
  epoch: '10000000-0000-4000-8000-000000000001',
  mode: 'active',
};
const credentials = { email: 'member@example.com', password: 'secret' };
const controllers: SessionController[] = [];

function setup(
  replies: ApiReply[],
  coordination: SessionCoordination,
  overrideAdapter?: AxiosAdapter,
) {
  const adapter = createApiAdapter(replies);
  const { auth } = createHttpClients({
    baseUrl: 'http://localhost:8080',
    getAccessToken: () => null,
    adapter: overrideAdapter ?? adapter,
  });
  const clearPrivateData = vi.fn();
  const controller = createSessionController({ transport: auth, coordination, clearPrivateData });
  controllers.push(controller);
  return { controller, adapter, clearPrivateData };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
});

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  vi.useRealTimers();
});

describe('memory session and refresh', () => {
  it('bootstraps once without a marker and persists only the control marker', async () => {
    const hub = createSessionCoordinationHub();
    const { controller, adapter } = setup([csrf(), successReply(session)], hub.connect());
    controller.start();
    await controller.restore();
    expect(controller.getAccessToken()).toBe(session.accessToken);
    expect(controller.getSnapshot()).toMatchObject({ status: 'authenticated', user: session.user });
    expect(controller.getSnapshot()).not.toHaveProperty('accessToken');
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(hub.writes).toHaveLength(1);
    expect(Object.keys(hub.writes[0] ?? {}).sort()).toEqual(['epoch', 'mode', 'version']);
    expect(JSON.stringify(hub.writes)).not.toContain(session.accessToken);
    await controller.restore();
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it.each(['signed-out', 'logout-pending', 'reauth-required', 'refresh-uncertain'] as const)(
    'does not bootstrap from %s after reload',
    async (mode) => {
      const hub = createSessionCoordinationHub({ ...active, mode });
      const { controller, adapter } = setup([], hub.connect());
      controller.start();
      await controller.restore();
      expect(adapter).not.toHaveBeenCalled();
      expect(controller.getAccessToken()).toBeNull();
      expect(controller.getSnapshot().status).not.toBe('authenticated');
    },
  );

  it('blocks automatic bootstrap from a malformed marker', async () => {
    const hub = createSessionCoordinationHub('invalid');
    const { controller, adapter } = setup([], hub.connect());
    controller.start();
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('reauth-required');
    expect(adapter).not.toHaveBeenCalled();
  });

  it('turns missing refresh cookies into anonymous state without retrying or logging out', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), errorReply('REFRESH_TOKEN_MISSING', 401)],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(hub.read()).toMatchObject({ mode: 'signed-out' });
    await vi.advanceTimersByTimeAsync(200_000);
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('refreshes at the ten-percent buffer and resets the timer', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), successReply(session), csrf(), successReply({ ...session, accessToken: 'rotated' })],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    await vi.advanceTimersByTimeAsync(89_999);
    expect(adapter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter).toHaveBeenCalledTimes(4);
    expect(controller.getAccessToken()).toBe('rotated');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it('caps the buffer at sixty seconds for long sessions', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), successReply({ ...session, expiresIn: 1800 }), csrf(), successReply(session)],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    await vi.advanceTimersByTimeAsync(1_739_999);
    expect(adapter).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it('checks the deadline after a sleeping tab wakes and single-flights callers', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [
        csrf(),
        successReply(session),
        csrf(),
        successReply({ ...session, accessToken: 'after-sleep' }),
      ],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    vi.setSystemTime(Date.now() + 101_000);
    expect(controller.getAccessToken()).toBeNull();
    controller.checkDeadline();
    const first = controller.restore();
    expect(controller.restore()).toBe(first);
    await Promise.all([first, controller.ensureAccessToken(), controller.ensureAccessToken()]);
    expect(controller.getAccessToken()).toBe('after-sleep');
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it('blocks uncertain refresh without a background logout or timer retry', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), new AxiosError('timeout', 'ECONNABORTED')],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('refresh-uncertain');
    expect(hub.read()).toMatchObject({ mode: 'refresh-uncertain' });
    await vi.advanceTimersByTimeAsync(200_000);
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(controller.getAccessToken()).toBeNull();
  });

  it('keeps pre-submit connection failures retryable by explicit user action', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [new AxiosError('offline', 'ERR_NETWORK'), csrf(), successReply(session)],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('connection-error');
    expect(hub.read()).toEqual(active);
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('authenticated');
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it.each([
    { code: 'REFRESH_TOKEN_EXPIRED', status: 401, expected: 'reauth-required' },
    { code: 'REFRESH_TOKEN_REVOKED', status: 401, expected: 'reauth-required' },
    { code: 'REFRESH_TOKEN_NOT_FOUND', status: 401, expected: 'reauth-required' },
    { code: 'ACCOUNT_LOCKED', status: 403, expected: 'locked' },
  ])(
    'clears current-session state for $code and stops refresh',
    async ({ code, status, expected }) => {
      const hub = createSessionCoordinationHub(active);
      const { controller, adapter } = setup([csrf(), errorReply(code, status)], hub.connect());
      controller.start();
      await controller.restore();
      expect(controller.getSnapshot().status).toBe(expected);
      expect(controller.getAccessToken()).toBeNull();
      await vi.advanceTimersByTimeAsync(200_000);
      expect(adapter).toHaveBeenCalledTimes(2);
    },
  );

  it('fails closed when required coordination primitives are unavailable', async () => {
    const hub = createSessionCoordinationHub(active);
    const unavailable = {
      ...hub.connect(),
      subscribe: () => {
        throw new CoordinationUnavailableError();
      },
    };
    const { controller, adapter } = setup([], unavailable);
    controller.start();
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({ status: 'unsupported', available: false });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('starts a new epoch if refresh restores another user after the previous token expired', async () => {
    const hub = createSessionCoordinationHub(active);
    const changed = { ...session, user: { ...session.user, id: 2, email: 'other@example.com' } };
    const { controller, clearPrivateData } = setup(
      [csrf(), successReply(session), csrf(), successReply(changed)],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    clearPrivateData.mockClear();
    vi.setSystemTime(Date.now() + 101_000);
    await controller.restore();
    expect(controller.getSnapshot()).toMatchObject({ status: 'authenticated', user: { id: 2 } });
    expect(hub.read()).not.toMatchObject({ epoch: active.epoch });
    expect(clearPrivateData).toHaveBeenCalled();
  });
});

describe('explicit login and registration', () => {
  it('enables login after a signed-out marker without bootstrapping the old cookie', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'signed-out' });
    const { controller, adapter, clearPrivateData } = setup(
      [csrf(), successReply(session)],
      hub.connect(),
    );
    controller.start();
    await controller.login(credentials, new AbortController().signal);
    expect(controller.getSnapshot().status).toBe('authenticated');
    expect(hub.read()).toMatchObject({ mode: 'active' });
    expect(clearPrivateData).toHaveBeenCalled();
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
    ]);
  });

  it.each(['logout-pending', 'refresh-uncertain'] as const)(
    'completes cleanup before login from %s within one auth lock',
    async (mode) => {
      const hub = createSessionCoordinationHub({ ...active, mode });
      const { controller, adapter } = setup(
        [csrf(), successReply(), csrf(), successReply(session)],
        hub.connect(),
      );
      controller.start();
      await controller.login(credentials, new AbortController().signal);
      expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
        '/api/v1/auth/csrf',
        '/api/v1/auth/logout',
        '/api/v1/auth/csrf',
        '/api/v1/auth/login',
      ]);
      expect(controller.getSnapshot().status).toBe('authenticated');
    },
  );

  it('does not send credentials if cleanup is not confirmed', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'refresh-uncertain' });
    const { controller, adapter } = setup(
      [csrf(), errorReply('INTERNAL_SERVER_ERROR', 500)],
      hub.connect(),
    );
    controller.start();
    await expect(controller.login(credentials, new AbortController().signal)).rejects.toMatchObject(
      { operation: 'logout' },
    );
    expect(hub.read()).toMatchObject({ mode: 'logout-pending' });
    expect(controller.getSnapshot().status).toBe('logout-pending');
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('does not recover an old session after invalid credentials', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'signed-out' });
    const { controller, adapter } = setup(
      [csrf(), errorReply('INVALID_CREDENTIALS', 401)],
      hub.connect(),
    );
    controller.start();
    await expect(controller.login(credentials, new AbortController().signal)).rejects.toMatchObject(
      { code: 'INVALID_CREDENTIALS' },
    );
    await controller.restore();
    expect(hub.read()).toMatchObject({ mode: 'reauth-required' });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(controller.getAccessToken()).toBeNull();
  });

  it('registers without activating a session', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'signed-out' });
    const user = {
      id: 1,
      email: credentials.email,
      fullName: 'Member',
      role: 'USER',
      status: 'ACTIVE',
    };
    const { controller } = setup([csrf(), successReply(user)], hub.connect());
    controller.start();
    await expect(
      controller.register(
        { ...credentials, fullName: 'Member', phone: '123' },
        new AbortController().signal,
      ),
    ).resolves.toEqual(user);
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(hub.read()).toMatchObject({ mode: 'signed-out' });
    expect(controller.getAccessToken()).toBeNull();
  });

  it('repairs invalid control only through explicit cleanup and login', async () => {
    const hub = createSessionCoordinationHub('invalid');
    const { controller, adapter } = setup(
      [csrf(), successReply(), csrf(), successReply(session)],
      hub.connect(),
    );
    controller.start();
    await controller.login(credentials, new AbortController().signal);
    expect(controller.getSnapshot().status).toBe('authenticated');
    expect(adapter.mock.calls[1]?.[0].url).toBe('/api/v1/auth/logout');
  });

  it('does not change the control marker for an already-aborted login', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'signed-out' });
    const { controller, adapter } = setup([], hub.connect());
    controller.start();
    const abort = new AbortController();
    abort.abort();
    await expect(controller.login(credentials, abort.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    });
    expect(hub.writes).toHaveLength(0);
    expect(adapter).not.toHaveBeenCalled();
  });

  it('does not immediately refresh a session response that arrived beyond its safe deadline', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'signed-out' });
    const base = createApiAdapter([csrf(), successReply(session)]);
    const delayed: AxiosAdapter = async (config) => {
      const response = await base(config);
      if (config.url === '/api/v1/auth/login') vi.setSystemTime(Date.now() + 91_000);
      return response;
    };
    const { controller } = setup([], hub.connect(), delayed);
    controller.start();
    await expect(controller.login(credentials, new AbortController().signal)).rejects.toMatchObject(
      { kind: 'protocol' },
    );
    expect(controller.getAccessToken()).toBeNull();
    expect(hub.read()).toMatchObject({ mode: 'reauth-required' });
    await vi.advanceTimersByTimeAsync(200_000);
    expect(base).toHaveBeenCalledTimes(2);
  });
});

describe('explicit logout', () => {
  it('supersedes an older login still waiting to publish its intent', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), successReply(session), csrf(), successReply()],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    const login = controller.login(credentials, new AbortController().signal);
    const cancelled = expect(login).rejects.toMatchObject({ kind: 'cancelled' });
    await controller.logout();
    await cancelled;
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(hub.read()).toMatchObject({ mode: 'signed-out' });
    expect(
      adapter.mock.calls.filter(([config]) => config.url === '/api/v1/auth/login'),
    ).toHaveLength(0);
  });

  it('allows an explicitly requested logout after the account is locked', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), errorReply('ACCOUNT_LOCKED', 403), csrf(), successReply()],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('locked');
    await controller.logout();
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(adapter.mock.calls[3]?.[0].url).toBe('/api/v1/auth/logout');
  });

  it('fails closed locally if the logout marker cannot be persisted', async () => {
    const hub = createSessionCoordinationHub(active);
    const connection = hub.connect();
    let unavailable = false;
    const coordination: SessionCoordination = {
      ...connection,
      change: (update) => {
        if (unavailable) return Promise.reject(new CoordinationUnavailableError());
        return connection.change(update);
      },
    };
    const { controller, adapter, clearPrivateData } = setup(
      [csrf(), successReply(session)],
      coordination,
    );
    controller.start();
    await controller.restore();
    clearPrivateData.mockClear();
    unavailable = true;
    await controller.logout();
    expect(controller.getSnapshot()).toMatchObject({ status: 'unsupported', available: false });
    expect(controller.getAccessToken()).toBeNull();
    expect(clearPrivateData).toHaveBeenCalled();
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('clears local state immediately, single-flights clicks and confirms sign-out without refresh', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter, clearPrivateData } = setup(
      [csrf(), successReply(session), csrf(), successReply(null)],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    clearPrivateData.mockClear();
    const signOut = controller.logout();
    expect(controller.logout()).toBe(signOut);
    expect(controller.getSnapshot().status).toBe('signing-out');
    expect(controller.getAccessToken()).toBeNull();
    expect(clearPrivateData).toHaveBeenCalled();
    await signOut;
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(hub.read()).toMatchObject({ mode: 'signed-out' });
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      '/api/v1/auth/csrf',
      '/api/v1/auth/logout',
    ]);
    expect(adapter.mock.calls[3]?.[0].withCredentials).toBe(true);
    expect(adapter.mock.calls[3]?.[0].headers.get('Authorization')).toBeUndefined();
    expect(adapter.mock.calls[3]?.[0].headers.get('X-XSRF-TOKEN')).toBe('masked-csrf');
    expect(adapter.mock.calls[3]?.[0].data).toBe('{}');
    await vi.advanceTimersByTimeAsync(200_000);
    await controller.restore();
    await controller.logout();
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it.each([
    errorReply('INTERNAL_SERVER_ERROR', 500),
    errorReply('ORIGIN_NOT_ALLOWED', 403),
    errorReply('AUTH_SESSION_BUSY', 409),
    new AxiosError('offline', 'ERR_NETWORK'),
    new AxiosError('timeout', 'ECONNABORTED'),
  ])('keeps pending state and blocks reload after an unconfirmed logout', async (failure) => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [csrf(), successReply(session), csrf(), failure],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    await controller.logout();
    expect(controller.getSnapshot().status).toBe('logout-pending');
    expect(hub.read()).toMatchObject({ mode: 'logout-pending' });
    expect(controller.getAccessToken()).toBeNull();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(adapter).toHaveBeenCalledTimes(4);
    const reloaded = setup([], hub.connect());
    reloaded.controller.start();
    await reloaded.controller.restore();
    expect(reloaded.controller.getSnapshot().status).toBe('logout-pending');
    expect(reloaded.adapter).not.toHaveBeenCalled();
  });

  it('retries only on user action with a new CSRF token after pre-submit failure', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, adapter } = setup(
      [
        csrf(),
        successReply(session),
        new AxiosError('offline', 'ERR_NETWORK'),
        csrf(),
        successReply(),
      ],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    await controller.logout();
    expect(controller.getSnapshot().status).toBe('logout-pending');
    expect(adapter).toHaveBeenCalledTimes(3);
    await controller.logout();
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(hub.read()).toMatchObject({ mode: 'signed-out' });
    expect(
      adapter.mock.calls.filter(([config]) => config.url === '/api/v1/auth/logout'),
    ).toHaveLength(1);
    expect(
      adapter.mock.calls.filter(([config]) => config.url === '/api/v1/auth/refresh'),
    ).toHaveLength(1);
  });

  it('allows a reloaded pending tab to retry without an access token', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'logout-pending' });
    const { controller, adapter } = setup([csrf(), successReply()], hub.connect());
    controller.start();
    await controller.logout();
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/logout',
    ]);
  });

  it('bounds CSRF repair and leaves pending after repeated CSRF rejection', async () => {
    const hub = createSessionCoordinationHub({ ...active, mode: 'logout-pending' });
    const { controller, adapter } = setup(
      [
        csrf(),
        errorReply('CSRF_TOKEN_INVALID', 403),
        csrf(),
        errorReply('CSRF_TOKEN_INVALID', 403),
      ],
      hub.connect(),
    );
    controller.start();
    await controller.logout();
    expect(controller.getSnapshot().status).toBe('logout-pending');
    await vi.advanceTimersByTimeAsync(200_000);
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it('clears both tabs and their timers when one tab signs out', async () => {
    const hub = createSessionCoordinationHub(active);
    const first = setup([csrf(), successReply(session), csrf(), successReply()], hub.connect());
    const second = setup([csrf(), successReply(session)], hub.connect());
    first.controller.start();
    second.controller.start();
    await Promise.all([first.controller.restore(), second.controller.restore()]);
    second.clearPrivateData.mockClear();
    await first.controller.logout();
    await vi.waitFor(() => expect(second.controller.getSnapshot().status).toBe('anonymous'));
    expect(first.controller.getAccessToken()).toBeNull();
    expect(second.controller.getAccessToken()).toBeNull();
    expect(second.clearPrivateData).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(first.adapter).toHaveBeenCalledTimes(4);
    expect(second.adapter).toHaveBeenCalledTimes(2);
  });

  it('blocks restoration immediately while logout waits for an older refresh lock', async () => {
    const hub = createSessionCoordinationHub(active);
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshCount = 0;
    const base = createApiAdapter([
      csrf(),
      successReply(session),
      csrf(),
      successReply({ ...session, accessToken: 'old-refresh' }),
      csrf(),
      successReply(),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh' && ++refreshCount === 2) await pending;
      return base(config);
    };
    const { controller } = setup([], hub.connect(), delayed);
    controller.start();
    await controller.restore();
    vi.setSystemTime(Date.now() + 91_000);
    const refreshing = controller.restore();
    await vi.waitFor(() => expect(refreshCount).toBe(2));
    const signingOut = controller.logout();
    try {
      await vi.waitFor(() => expect(hub.read()).toMatchObject({ mode: 'logout-pending' }));
      expect(controller.getSnapshot().status).toBe('signing-out');
      expect(controller.getAccessToken()).toBeNull();
      await controller.restore();
      const freshTab = setup([], hub.connect());
      freshTab.controller.start();
      await freshTab.controller.restore();
      expect(freshTab.adapter).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await Promise.all([refreshing, signingOut]);
    expect(controller.getSnapshot().status).toBe('anonymous');
    expect(controller.getAccessToken()).toBeNull();
    expect(base).toHaveBeenCalledTimes(6);
  });

  it.each([successReply(), errorReply('INTERNAL_SERVER_ERROR', 500)])(
    'ignores a stale logout response after a newer login intent',
    async (oldReply) => {
      const hub = createSessionCoordinationHub(active);
      const connection = hub.connect();
      const silent = { ...connection, subscribe: () => () => undefined };
      let release: () => void = () => undefined;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      let logoutStarted = false;
      const base = createApiAdapter([csrf(), successReply(session), csrf(), oldReply]);
      const delayed: AxiosAdapter = async (config) => {
        if (config.url === '/api/v1/auth/logout') {
          logoutStarted = true;
          await pending;
        }
        return base(config);
      };
      const oldTab = setup([], silent, delayed).controller;
      oldTab.start();
      await oldTab.restore();
      const oldLogout = oldTab.logout();
      await vi.waitFor(() => expect(logoutStarted).toBe(true));
      const logoutEpoch = oldTab.getSnapshot().epoch;
      const newer = setup(
        [csrf(), successReply(), csrf(), successReply({ ...session, accessToken: 'new-access' })],
        hub.connect(),
      );
      newer.controller.start();
      const login = newer.controller.login(credentials, new AbortController().signal);
      try {
        await vi.waitFor(() => expect(hub.read()).not.toMatchObject({ epoch: logoutEpoch }));
      } finally {
        release();
      }
      await Promise.all([oldLogout, login]);
      expect(hub.read()).toMatchObject({ mode: 'active' });
      expect(newer.controller.getAccessToken()).toBe('new-access');
      expect(oldTab.getAccessToken()).toBeNull();
      expect(base).toHaveBeenCalledTimes(4);
    },
  );

  it('retains pending across unmount and ignores the aborted response after remount', async () => {
    const hub = createSessionCoordinationHub(active);
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let submitted = false;
    const base = createApiAdapter([csrf(), successReply(session), csrf(), successReply()]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/logout') {
        submitted = true;
        await pending;
      }
      return base(config);
    };
    const { controller } = setup([], hub.connect(), delayed);
    controller.start();
    await controller.restore();
    const loggingOut = controller.logout();
    try {
      await vi.waitFor(() => expect(submitted).toBe(true));
      await controller.stop();
      controller.start();
      await controller.restore();
      expect(controller.getSnapshot().status).toBe('logout-pending');
      expect(hub.read()).toMatchObject({ mode: 'logout-pending' });
    } finally {
      release();
    }
    await loggingOut;
    expect(controller.getSnapshot().status).toBe('logout-pending');
    expect(base).toHaveBeenCalledTimes(4);
  });
});

describe('cross-tab and lifecycle races', () => {
  it('hides expired access while a slow proactive refresh is still pending', async () => {
    const hub = createSessionCoordinationHub(active);
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshCount = 0;
    const base = createApiAdapter([
      csrf(),
      successReply(session),
      csrf(),
      successReply({ ...session, accessToken: 'fresh' }),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh' && ++refreshCount === 2) await pending;
      return base(config);
    };
    const { controller, clearPrivateData } = setup([], hub.connect(), delayed);
    controller.start();
    await controller.restore();
    clearPrivateData.mockClear();
    let refresh: Promise<void>;
    try {
      await vi.advanceTimersByTimeAsync(90_000);
      refresh = controller.restore();
      expect(controller.getSnapshot().status).toBe('authenticated');
      await vi.advanceTimersByTimeAsync(10_000);
      expect(controller.getSnapshot().status).toBe('restoring');
      expect(controller.getAccessIdentity()).toBeNull();
      expect(clearPrivateData).toHaveBeenCalled();
    } finally {
      release();
    }
    await refresh;
    expect(controller.getAccessToken()).toBe('fresh');
    expect(controller.getSnapshot().status).toBe('authenticated');
  });

  it('changes epoch and clears private data when refresh changes the role', async () => {
    const hub = createSessionCoordinationHub(active);
    const { controller, clearPrivateData } = setup(
      [
        csrf(),
        successReply(session),
        csrf(),
        successReply({ ...session, user: { ...session.user, role: 'ADMIN' } }),
      ],
      hub.connect(),
    );
    controller.start();
    await controller.restore();
    clearPrivateData.mockClear();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(controller.getSnapshot()).toMatchObject({
      status: 'authenticated',
      user: { role: 'ADMIN' },
    });
    expect(hub.read()).not.toMatchObject({ epoch: active.epoch });
    expect(clearPrivateData).toHaveBeenCalled();
  });

  it('serializes refresh from two tabs while each keeps its own memory token', async () => {
    const hub = createSessionCoordinationHub(active);
    let inFlight = 0;
    let peak = 0;
    let issued = 0;
    const adapter: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/csrf') {
        const reply = csrf();
        return { ...reply, statusText: '', headers: {}, config };
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      const reply = successReply({ ...session, accessToken: `tab-token-${++issued}` });
      return { ...reply, statusText: '', headers: {}, config };
    };
    const first = setup([], hub.connect(), adapter).controller;
    const second = setup([], hub.connect(), adapter).controller;
    first.start();
    second.start();
    await Promise.all([first.restore(), second.restore()]);
    expect(peak).toBe(1);
    expect(issued).toBe(2);
    expect(first.getAccessToken()).toBe('tab-token-1');
    expect(second.getAccessToken()).toBe('tab-token-2');
  });

  it('ignores an old refresh error after a newer login intent even before notifications arrive', async () => {
    const hub = createSessionCoordinationHub(active);
    const connection = hub.connect();
    const silent = { ...connection, subscribe: () => () => undefined };
    let rejectOld: (error: unknown) => void = () => undefined;
    const oldResponse = new Promise<never>((...callbacks) => {
      rejectOld = callbacks[1];
    });
    const before = createApiAdapter([csrf(), successReply(session), csrf()]);
    let refreshCount = 0;
    const delayed: AxiosAdapter = (config) => {
      if (config.url === '/api/v1/auth/refresh' && ++refreshCount === 2) return oldResponse;
      return before(config);
    };
    const oldTab = setup([], silent, delayed).controller;
    oldTab.start();
    await oldTab.restore();
    vi.setSystemTime(Date.now() + 91_000);
    const oldFlight = oldTab.restore();
    await vi.waitFor(() => expect(refreshCount).toBe(2));
    const newSession = {
      ...session,
      accessToken: 'new-user-access',
      user: { ...session.user, id: 2, email: 'new@example.com' },
    };
    const newTab = setup([csrf(), successReply(newSession)], hub.connect()).controller;
    // Start with a valid token in another tab; its initial refresh joins the
    // old lock, then explicit login replaces that queued bootstrap intent.
    newTab.start();
    const login = newTab.login(
      { ...credentials, email: 'new@example.com' },
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(hub.read()).toMatchObject({ mode: 'reauth-required' }));
    rejectOld(new AxiosError('old response', 'ERR_BAD_REQUEST', undefined, undefined, undefined));
    await oldFlight;
    await login;
    expect(hub.read()).toMatchObject({ mode: 'active' });
    expect(newTab.getAccessToken()).toBe('new-user-access');
    expect(newTab.getSnapshot()).toMatchObject({ status: 'authenticated', user: { id: 2 } });
    expect(oldTab.getAccessToken()).toBeNull();
  });

  it('notifies other tabs to drop memory when a current refresh is terminally rejected', async () => {
    const hub = createSessionCoordinationHub(active);
    const first = setup(
      [csrf(), successReply(session), csrf(), errorReply('REFRESH_TOKEN_REVOKED', 401)],
      hub.connect(),
    );
    const second = setup([csrf(), successReply(session)], hub.connect());
    first.controller.start();
    second.controller.start();
    await Promise.all([first.controller.restore(), second.controller.restore()]);
    vi.setSystemTime(Date.now() + 91_000);
    await first.controller.restore();
    await Promise.resolve();
    expect(first.controller.getAccessToken()).toBeNull();
    expect(second.controller.getAccessToken()).toBeNull();
    expect(second.controller.getSnapshot().status).toBe('reauth-required');
    expect(second.adapter).toHaveBeenCalledTimes(2);
  });

  it('supports StrictMode-style setup/cleanup/setup without parallel bootstrap', async () => {
    const hub = createSessionCoordinationHub();
    const { controller, adapter } = setup([csrf(), successReply(session)], hub.connect());
    controller.start();
    const stopped = controller.stop();
    controller.start();
    await stopped;
    await controller.restore();
    expect(controller.getSnapshot().status).toBe('authenticated');
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'blocks remount bootstrap after interrupted refresh (immediate remount: %s)',
    async (immediateRemount) => {
      const hub = createSessionCoordinationHub(active);
      let releaseResponse: () => void = () => undefined;
      const pendingResponse = new Promise<void>((resolve) => {
        releaseResponse = resolve;
      });
      let refreshCount = 0;
      const base = createApiAdapter([csrf(), successReply(session), csrf(), successReply(session)]);
      const delayed: AxiosAdapter = async (config) => {
        if (config.url === '/api/v1/auth/refresh' && ++refreshCount === 2) await pendingResponse;
        return base(config);
      };
      const { controller } = setup([], hub.connect(), delayed);
      controller.start();
      await controller.restore();
      vi.setSystemTime(Date.now() + 91_000);
      const interrupted = controller.restore();
      await vi.waitFor(() => expect(refreshCount).toBe(2));
      try {
        const stopped = controller.stop();
        if (immediateRemount) controller.start();
        await stopped;
        expect(hub.read()).toMatchObject({ mode: 'refresh-uncertain' });
        if (!immediateRemount) controller.start();
        await controller.restore();
        expect(controller.getSnapshot().status).toBe('refresh-uncertain');
        expect(base).toHaveBeenCalledTimes(3);
        expect(refreshCount).toBe(2);
      } finally {
        releaseResponse();
      }
      await interrupted;
      expect(controller.getSnapshot().status).toBe('refresh-uncertain');
      expect(controller.getAccessToken()).toBeNull();
      expect(base).toHaveBeenCalledTimes(4);
    },
  );
});
