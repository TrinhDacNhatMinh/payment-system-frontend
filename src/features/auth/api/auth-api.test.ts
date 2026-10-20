import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { createHttpClients } from '@/shared/api/http-client';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createAuthApi, type WithAuthLock } from './auth-api';

const session = {
  accessToken: 'test-access',
  tokenType: 'Bearer',
  expiresIn: 1800,
  user: { id: 1, email: 'member@example.com', role: 'USER' },
};
const csrf = (token = 'csrf-one') => successReply({ headerName: 'X-XSRF-TOKEN', token });
const credentials = { email: 'member@example.com', password: ' keep whitespace ' };

function setup(replies: ApiReply[]) {
  const adapter = createApiAdapter(replies);
  const lock = vi.fn();
  const withAuthLock: WithAuthLock = (operation) => {
    lock();
    return operation();
  };
  const { auth } = createHttpClients({
    baseUrl: 'http://localhost:8080',
    getAccessToken: () => null,
    adapter,
  });
  return { api: createAuthApi(auth, withAuthLock), adapter, lock };
}

describe('auth endpoint adapter', () => {
  it('gets masked CSRF before login under one injected lock and preserves the password', async () => {
    const { api, adapter, lock } = setup([csrf(), successReply(session)]);
    await expect(api.login(credentials)).resolves.toEqual(session);
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/login',
    ]);
    expect(adapter.mock.calls[1]?.[0].data).toBe(JSON.stringify(credentials));
    expect(adapter.mock.calls[1]?.[0].headers.get('X-XSRF-TOKEN')).toBe('csrf-one');
    expect(lock).toHaveBeenCalledTimes(1);
  });

  it.each(['CSRF_TOKEN_MISSING', 'CSRF_TOKEN_INVALID'])(
    'retries only one confirmed 403 %s with fresh CSRF',
    async (code) => {
      const { api, adapter, lock } = setup([
        csrf(),
        errorReply(code, 403),
        csrf('csrf-two'),
        successReply(session),
      ]);
      await expect(api.login(credentials)).resolves.toEqual(session);
      expect(adapter).toHaveBeenCalledTimes(4);
      expect(adapter.mock.calls[3]?.[0].headers.get('X-XSRF-TOKEN')).toBe('csrf-two');
      expect(lock).toHaveBeenCalledTimes(1);
    },
  );

  it('stops after a second CSRF rejection', async () => {
    const { api, adapter } = setup([
      csrf(),
      errorReply('CSRF_TOKEN_INVALID', 403),
      csrf(),
      errorReply('CSRF_TOKEN_INVALID', 403),
    ]);
    await expect(api.refresh()).rejects.toMatchObject({
      operation: 'refresh',
      phase: 'submit',
      code: 'CSRF_TOKEN_INVALID',
    });
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it.each([
    { code: 'INVALID_CREDENTIALS', status: 401 },
    { code: 'ACCOUNT_LOCKED', status: 403 },
    { code: 'ORIGIN_NOT_ALLOWED', status: 403 },
    { code: 'AUTH_SESSION_BUSY', status: 409 },
    { code: 'INTERNAL_SERVER_ERROR', status: 500 },
    { code: 'CSRF_TOKEN_INVALID', status: 200 },
  ])('does not retry login or call refresh/logout for $code', async ({ code, status }) => {
    const { api, adapter } = setup([csrf(), errorReply(code, status)]);
    await expect(api.login(credentials)).rejects.toMatchObject({ code, status, phase: 'submit' });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('distinguishes a failure fetching CSRF from an uncertain submitted refresh', async () => {
    const beforePost = setup([new AxiosError('offline', 'ERR_NETWORK')]);
    await expect(beforePost.api.refresh()).rejects.toMatchObject({
      phase: 'csrf',
      kind: 'network',
    });
    expect(beforePost.adapter).toHaveBeenCalledTimes(1);
    const afterPost = setup([csrf(), new AxiosError('timeout', 'ECONNABORTED')]);
    await expect(afterPost.api.refresh()).rejects.toMatchObject({
      phase: 'submit',
      kind: 'timeout',
    });
    expect(afterPost.adapter).toHaveBeenCalledTimes(2);
  });

  it.each([
    'REFRESH_TOKEN_MISSING',
    'REFRESH_TOKEN_EXPIRED',
    'REFRESH_TOKEN_REVOKED',
    'REFRESH_TOKEN_NOT_FOUND',
  ])('preserves refresh rejection %s without a background logout or retry', async (code) => {
    const { api, adapter } = setup([csrf(), errorReply(code, 401)]);
    await expect(api.refresh()).rejects.toMatchObject({
      operation: 'refresh',
      phase: 'submit',
      code,
    });
    expect(adapter).toHaveBeenCalledTimes(2);
    expect(adapter.mock.calls[1]?.[0].data).toBe('{}');
  });

  it('gets new CSRF for logout after login, accepts absent data and sends no body token', async () => {
    const { api, adapter } = setup([
      csrf(),
      successReply(session),
      csrf('csrf-new'),
      successReply(),
    ]);
    await api.login(credentials);
    await expect(api.logout()).resolves.toBeUndefined();
    expect(adapter.mock.calls[3]?.[0].data).toBe('{}');
    expect(adapter.mock.calls[3]?.[0].headers.get('X-XSRF-TOKEN')).toBe('csrf-new');
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it('registers without creating or requesting a session', async () => {
    const user = {
      id: 1,
      email: credentials.email,
      fullName: 'Member',
      role: 'USER',
      status: 'ACTIVE',
    };
    const { api, adapter } = setup([csrf(), successReply(user)]);
    await expect(
      api.register({ ...credentials, fullName: 'Member', phone: '123' }),
    ).resolves.toEqual(user);
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/register',
    ]);
  });

  it('rejects an unexpected CSRF header before sending credentials', async () => {
    const { api, adapter } = setup([successReply({ headerName: 'Authorization', token: 'csrf' })]);
    await expect(api.login(credentials)).rejects.toMatchObject({ kind: 'protocol', phase: 'csrf' });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed session data without retaining tokens in the error', async () => {
    const { api } = setup([csrf(), successReply({ ...session, expiresIn: 0 })]);
    const failure = await api.login(credentials).catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'protocol', phase: 'submit' });
    expect(JSON.stringify(failure)).not.toContain(session.accessToken);
  });

  it('does not issue a request when lock acquisition fails', async () => {
    const adapter = createApiAdapter([]);
    const { auth } = createHttpClients({
      baseUrl: 'http://localhost:8080',
      getAccessToken: () => null,
      adapter,
    });
    const api = createAuthApi(auth, async () => {
      throw new Error('Lock unavailable');
    });
    await expect(api.refresh()).rejects.toMatchObject({ kind: 'client', phase: 'lock' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('propagates cancellation without sending or retrying an aborted operation', async () => {
    const { api, adapter } = setup([]);
    const controller = new AbortController();
    controller.abort();
    await expect(api.login(credentials, controller.signal)).rejects.toMatchObject({
      operation: 'login',
      phase: 'csrf',
      kind: 'cancelled',
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});
