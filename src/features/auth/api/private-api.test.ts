import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { requireSessionAccess } from '../model/session-access';
import type { SessionController } from '../model/session-controller';

const controllers: SessionController[] = [];
const resultSchema = z.object({ value: z.number() });
const read = { method: 'GET', path: '/api/v1/wallets/me' } as const;

async function setup(replies: ApiReply[], adapter?: AxiosAdapter) {
  const fixture = createSessionFixture([csrfReply(), successReply(testSession), ...replies], {
    adapter,
  });
  controllers.push(fixture.controller);
  fixture.controller.start();
  const access = await requireSessionAccess(fixture.controller);
  return { ...fixture, access, api: fixture.privateApi(access) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
});
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  vi.useRealTimers();
});

describe('session-bound private API', () => {
  it('uses the verified memory token without cookies and returns validated data', async () => {
    const { api, adapter } = await setup([successReply({ value: 1 })]);
    await expect(api.request(read, resultSchema)).resolves.toEqual({ value: 1 });
    const config = adapter.mock.calls[2]?.[0];
    expect(config?.headers.get('Authorization')).toBe('Bearer test-access');
    expect(config?.withCredentials).toBe(false);
  });

  it('forces refresh for an exact TOKEN_EXPIRED read even when local TTL is still fresh', async () => {
    const { api, adapter } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply({ ...testSession, accessToken: 'rotated' }),
      successReply({ value: 2 }),
    ]);
    await expect(api.request(read, resultSchema)).resolves.toEqual({ value: 2 });
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      read.path,
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      read.path,
    ]);
    expect(adapter.mock.calls[5]?.[0].headers.get('Authorization')).toBe('Bearer rotated');
  });

  it('single-flights concurrent expired reads and replays each only once', async () => {
    const { api, adapter } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply({ ...testSession, accessToken: 'rotated' }),
      successReply({ value: 1 }),
      successReply({ value: 2 }),
    ]);
    const results = await Promise.all([
      api.request(read, resultSchema),
      api.request(read, resultSchema),
    ]);
    expect(results.map((result) => result.value).sort()).toEqual([1, 2]);
    expect(
      adapter.mock.calls.filter(([config]) => config.url === '/api/v1/auth/refresh'),
    ).toHaveLength(2);
    expect(adapter.mock.calls.filter(([config]) => config.url === read.path)).toHaveLength(4);
  });

  it('ends the current session if the single replay is still expired', async () => {
    const { api, adapter, controller } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply(testSession),
      errorReply('TOKEN_EXPIRED', 401),
    ]);
    await expect(api.request(read, resultSchema)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(controller.getSnapshot().status).toBe('reauth-required');
    expect(adapter).toHaveBeenCalledTimes(6);
  });

  it('does not replay the read if refresh itself is rejected', async () => {
    const { api, adapter, controller } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      errorReply('REFRESH_TOKEN_REVOKED', 401),
    ]);
    await expect(api.request(read, resultSchema)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(controller.getSnapshot().status).toBe('reauth-required');
    expect(adapter.mock.calls.filter(([config]) => config.url === read.path)).toHaveLength(1);
  });

  it.each(['POST', 'PATCH'] as const)(
    'never refreshes or replays a %s mutation after expired auth',
    async (method) => {
      const { api, adapter } = await setup([errorReply('TOKEN_EXPIRED', 401)]);
      await expect(
        api.request({ ...read, method, data: { amount: 10000 } }, resultSchema),
      ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
      expect(adapter).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    { code: 'ACCESS_DENIED', status: 403, expected: 'authenticated' },
    { code: 'TOKEN_INVALID', status: 401, expected: 'reauth-required' },
    { code: 'UNAUTHORIZED', status: 401, expected: 'reauth-required' },
    { code: 'ACCOUNT_LOCKED', status: 403, expected: 'locked' },
    { code: 'VALIDATION_ERROR', status: 400, expected: 'authenticated' },
    { code: 'INTERNAL_SERVER_ERROR', status: 500, expected: 'authenticated' },
  ])('does not treat $code as a refresh trigger', async ({ code, status, expected }) => {
    const { api, adapter, controller } = await setup([errorReply(code, status)]);
    await expect(api.request(read, resultSchema)).rejects.toMatchObject({ code });
    expect(controller.getSnapshot().status).toBe(expected);
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it.each(['ERR_NETWORK', 'ECONNABORTED'])(
    'does not refresh or retry transport error %s',
    async (code) => {
      const { api, adapter, controller } = await setup([new AxiosError('test failure', code)]);
      await expect(api.request(read, resultSchema)).rejects.toMatchObject({
        kind: code === 'ERR_NETWORK' ? 'network' : 'timeout',
      });
      expect(controller.getSnapshot().status).toBe('authenticated');
      expect(adapter).toHaveBeenCalledTimes(3);
    },
  );

  it('accepts successful HEAD without inventing a response body', async () => {
    const { api, adapter } = await setup([{ status: 200, data: undefined }]);
    await expect(api.request({ ...read, method: 'HEAD' }, z.undefined())).resolves.toBeUndefined();
    expect(adapter.mock.calls[2]?.[0].headers.get('Content-Type')).toBeUndefined();
  });

  it('cancels one expired reader without cancelling the shared refresh for another', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshCount = 0;
    let refreshing = false;
    const base = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      errorReply('TOKEN_EXPIRED', 401),
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply({ ...testSession, accessToken: 'rotated' }),
      successReply({ value: 2 }),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/auth/refresh' && ++refreshCount === 2) {
        refreshing = true;
        await pending;
      }
      return base(config);
    };
    const { api, controller } = await setup([], delayed);
    const abort = new AbortController();
    const first = api.request({ ...read, signal: abort.signal }, resultSchema);
    const cancelled = expect(first).rejects.toMatchObject({ kind: 'cancelled' });
    const second = api.request(read, resultSchema);
    try {
      await vi.waitFor(() => expect(refreshing).toBe(true));
      abort.abort();
      await cancelled;
      expect(controller.getAccessToken()).toBe(testSession.accessToken);
    } finally {
      release();
    }
    await expect(second).resolves.toEqual({ value: 2 });
    expect(controller.getAccessToken()).toBe('rotated');
    expect(base).toHaveBeenCalledTimes(7);
  });

  it.each([successReply({ value: 9 }), errorReply('TOKEN_INVALID', 401)])(
    'discards old-user data and errors after a new login',
    async (oldReply) => {
      let release: () => void = () => undefined;
      let started = false;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const base = createApiAdapter([
        csrfReply(),
        successReply(testSession),
        csrfReply(),
        successReply({
          ...testSession,
          accessToken: 'other-token',
          user: { ...testSession.user, id: 2, email: 'other@example.com' },
        }),
        oldReply,
      ]);
      const delayed: AxiosAdapter = async (config) => {
        if (config.url === read.path) {
          started = true;
          await pending;
        }
        return base(config);
      };
      const { api, controller } = await setup([], delayed);
      const oldRequest = api.request(read, resultSchema);
      const rejected = expect(oldRequest).rejects.toMatchObject({ name: 'SessionAccessError' });
      try {
        await vi.waitFor(() => expect(started).toBe(true));
        await controller.login(
          { email: 'other@example.com', password: 'secret' },
          new AbortController().signal,
        );
      } finally {
        release();
      }
      await rejected;
      expect(controller.getAccessToken()).toBe('other-token');
      expect(controller.getSnapshot()).toMatchObject({ status: 'authenticated', user: { id: 2 } });
      await expect(api.request(read, resultSchema)).rejects.toMatchObject({
        name: 'SessionAccessError',
      });
      expect(base).toHaveBeenCalledTimes(5);
    },
  );
});
