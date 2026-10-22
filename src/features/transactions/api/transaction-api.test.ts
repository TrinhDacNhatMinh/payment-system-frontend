import { AxiosError } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { createTransactionApi, MY_TRANSACTIONS_PATH } from './transaction-api';
import { transactionPage } from './transaction-fixture.test-support';

const controllers: SessionController[] = [];

async function setup(replies: ApiReply[]) {
  const fixture = createSessionFixture([csrfReply(), successReply(testSession), ...replies]);
  controllers.push(fixture.controller);
  fixture.controller.start();
  const access = await requireSessionAccess(fixture.controller);
  return { ...fixture, api: createTransactionApi(fixture.privateApi, access) };
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('personal transaction API', () => {
  it('sends only validated selectors through a bearer GET without cookies or CSRF', async () => {
    const { api, adapter } = await setup([successReply(transactionPage)]);
    const filters = {
      type: 'TRANSFER_OUT',
      status: 'SUCCESS',
      fromDate: '2026-10-22T00:00:00',
      toDate: '2026-10-22T23:59:59.999999',
    } as const;
    await expect(api.getHistory(filters)).resolves.toEqual(transactionPage);
    const config = adapter.mock.calls[2]?.[0];
    expect(config?.url).toBe(MY_TRANSACTIONS_PATH);
    expect(config?.method).toBe('get');
    expect(config?.params).toEqual({ ...filters, page: 0, size: 10 });
    expect(config?.headers.get('Authorization')).toBe('Bearer test-access');
    expect(config?.headers.get('X-XSRF-TOKEN')).toBeUndefined();
    expect(config?.withCredentials).toBe(false);
    expect(config?.data).toBeUndefined();
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it('blocks invalid pagination, reversed dates and already-cancelled reads before sending', async () => {
    const { api, adapter } = await setup([]);
    await expect(api.getHistory({ size: 101 })).rejects.toMatchObject({ kind: 'client' });
    await expect(
      api.getHistory({
        fromDate: '2026-10-23T00:00:00',
        toDate: '2026-10-22T00:00:00',
      }),
    ).rejects.toMatchObject({ kind: 'client' });
    const abort = new AbortController();
    abort.abort();
    await expect(api.getHistory({}, abort.signal)).rejects.toMatchObject({ kind: 'cancelled' });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('rejects mismatched page metadata instead of displaying it under the requested page', async () => {
    const { api } = await setup([
      successReply({ ...transactionPage, content: [], page: 1 }),
      successReply({ ...transactionPage, size: 20 }),
    ]);
    await expect(api.getHistory()).rejects.toMatchObject({ kind: 'protocol' });
    await expect(api.getHistory()).rejects.toMatchObject({ kind: 'protocol' });
  });

  it.each([
    ['VALIDATION_ERROR', 400],
    ['WALLET_NOT_FOUND', 404],
    ['ACCESS_DENIED', 403],
    ['ACCOUNT_LOCKED', 403],
    ['INTERNAL_SERVER_ERROR', 500],
  ] as const)(
    'preserves %s without fabricating an empty page or retrying',
    async (code, status) => {
      const { api, adapter } = await setup([errorReply(code, status)]);
      const failure: unknown = await api.getHistory().catch((error: unknown) => error);
      expect(failure).toMatchObject({ kind: 'business', code, status });
      expect(String(failure)).not.toContain('Raw server text');
      expect(adapter).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    ['ERR_NETWORK', 'network'],
    ['ECONNABORTED', 'timeout'],
  ])('does not retry transport failure %s', async (code, kind) => {
    const { api, adapter } = await setup([new AxiosError('private response', code)]);
    await expect(api.getHistory()).rejects.toMatchObject({ kind });
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it('renews an expired token once and replays only the same history read', async () => {
    const { api, adapter } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply({ ...testSession, accessToken: 'rotated' }),
      successReply(transactionPage),
    ]);
    await expect(api.getHistory()).resolves.toEqual(transactionPage);
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      MY_TRANSACTIONS_PATH,
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      MY_TRANSACTIONS_PATH,
    ]);
    expect(adapter.mock.calls[5]?.[0].headers.get('Authorization')).toBe('Bearer rotated');
    expect(adapter.mock.calls[5]?.[0].params).toEqual(adapter.mock.calls[2]?.[0].params);
  });
});
