import { AxiosError, CanceledError } from 'axios';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApiAdapter, errorReply, successReply } from '@/test/api-adapter';
import { createHttpClients } from './http-client';

const baseUrl = 'http://localhost:8080';

describe('HTTP client isolation', () => {
  it.each([
    {
      method: 'GET',
      path: '/api/v1/transfer',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    },
    {
      method: 'POST',
      path: '/api/v1/payment/deposit',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
    },
    { method: 'POST', path: '/api/v1/transfer', idempotencyKey: 'bad\r\nAuthorization: secret' },
  ] as const)(
    'restricts idempotency headers to valid transfer submissions: $method $path',
    async (request) => {
      const adapter = createApiAdapter([]);
      const { business } = createHttpClients({ baseUrl, getAccessToken: () => 'access', adapter });
      await expect(business.request(request, z.unknown())).rejects.toMatchObject({
        kind: 'client',
      });
      expect(adapter).not.toHaveBeenCalled();
    },
  );

  it('does not send a transfer key through the cookie-auth client', async () => {
    const adapter = createApiAdapter([]);
    const { auth } = createHttpClients({ baseUrl, getAccessToken: () => null, adapter });
    await expect(
      auth.request(
        {
          method: 'POST',
          path: '/api/v1/auth/login',
          csrfToken: 'csrf',
          idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        },
        z.unknown(),
      ),
    ).rejects.toMatchObject({ kind: 'client' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('sends auth cookies/JSON CSRF without a bearer token or cookie-based XSRF lookup', async () => {
    const adapter = createApiAdapter([successReply('ok')]);
    const { auth } = createHttpClients({
      baseUrl,
      getAccessToken: () => 'private-access',
      adapter,
    });
    await auth.request(
      { method: 'POST', path: '/api/v1/auth/login', data: {}, csrfToken: 'masked-csrf' },
      z.string(),
    );
    const config = adapter.mock.calls[0]?.[0];
    expect(config?.baseURL).toBe(baseUrl);
    expect(config?.timeout).toBe(15_000);
    expect(config?.withCredentials).toBe(true);
    expect(config?.withXSRFToken).toBe(false);
    expect(config?.headers.get('Authorization')).toBeUndefined();
    expect(config?.headers.get('X-XSRF-TOKEN')).toBe('masked-csrf');
    expect(config?.headers.get('Content-Type')).toBe('application/json');
  });

  it('reads the current memory bearer for each business request, without cookie/CSRF credentials', async () => {
    let token = 'first-access';
    const adapter = createApiAdapter([successReply('ok'), successReply('ok')]);
    const { business } = createHttpClients({ baseUrl, getAccessToken: () => token, adapter });
    await business.request({ method: 'GET', path: '/api/v1/wallet/me' }, z.string());
    token = 'new-access';
    await business.request({ method: 'GET', path: '/api/v1/wallet/me' }, z.string());
    expect(adapter.mock.calls[0]?.[0].headers.get('Authorization')).toBe('Bearer first-access');
    const config = adapter.mock.calls[1]?.[0];
    expect(config?.headers.get('Authorization')).toBe('Bearer new-access');
    expect(config?.withCredentials).toBe(false);
    expect(config?.headers.get('X-XSRF-TOKEN')).toBeUndefined();
  });

  it.each([
    'https://other.example/api/v1/wallet/me',
    '//other.example/api/v1/wallet/me',
    '/api/v1/../auth/login',
    '/api/v1/%2e%2e/auth/login',
    '/api/v1/wallet\\me',
    '/api/v1/auth/login',
    '/api/v1/wallet/me?token=secret',
  ])('rejects unsafe or auth paths on the bearer client before sending', async (path) => {
    const adapter = createApiAdapter([]);
    const { business } = createHttpClients({
      baseUrl,
      getAccessToken: () => 'private-access',
      adapter,
    });
    await expect(business.request({ method: 'GET', path }, z.unknown())).rejects.toMatchObject({
      kind: 'client',
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('blocks business requests before authentication', async () => {
    const adapter = createApiAdapter([]);
    const { business } = createHttpClients({ baseUrl, getAccessToken: () => null, adapter });
    await expect(
      business.request({ method: 'GET', path: '/api/v1/wallet/me' }, z.unknown()),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(adapter).not.toHaveBeenCalled();
  });

  it('does not refresh or replay a business mutation rejected with TOKEN_EXPIRED', async () => {
    const adapter = createApiAdapter([errorReply('TOKEN_EXPIRED', 401)]);
    const { business } = createHttpClients({
      baseUrl,
      getAccessToken: () => 'expired-access',
      adapter,
    });
    await expect(
      business.request({ method: 'POST', path: '/api/v1/transfer', data: {} }, z.unknown()),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED', status: 401 });
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it.each([
    { error: new AxiosError('sensitive password', 'ERR_NETWORK'), kind: 'network' },
    { error: new AxiosError('sensitive password', 'ECONNABORTED'), kind: 'timeout' },
    { error: new AxiosError('sensitive password', 'ETIMEDOUT'), kind: 'timeout' },
    { error: new CanceledError('sensitive password'), kind: 'cancelled' },
    { error: new AxiosError('sensitive password', 'ERR_BAD_RESPONSE'), kind: 'protocol' },
  ])('normalizes $kind without retaining sensitive Axios details', async ({ error, kind }) => {
    const adapter = createApiAdapter([error]);
    const { auth } = createHttpClients({ baseUrl, getAccessToken: () => null, adapter });
    const failure = await auth
      .request({ method: 'GET', path: '/api/v1/auth/csrf' }, z.unknown())
      .catch((caught: unknown) => caught);
    expect(failure).toMatchObject({ kind });
    expect(failure).not.toHaveProperty('config');
    expect(failure).not.toHaveProperty('response');
    expect(String(failure)).not.toContain('sensitive password');
    expect(adapter).toHaveBeenCalledTimes(1);
  });
});
