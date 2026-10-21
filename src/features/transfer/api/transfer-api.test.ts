import { AxiosError, CanceledError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { createTransferApi } from './transfer-api';

const key = '550e8400-e29b-41d4-a716-446655440000';
const request = { toEmail: 'Recipient@example.com', amount: '1000', description: '  lunch  ' };
const receipt = {
  transactionId: 9,
  fromWalletBalance: '0',
  amount: '1000',
  status: 'SUCCESS',
  createdAt: '2026-10-21T14:30:00.123456',
};
const pending = {
  idempotencyKey: key,
  state: 'PENDING',
  request,
  result: null,
  error: null,
  legacyFractional: false,
};
const controllers: SessionController[] = [];

async function setup(replies: ApiReply[], adapter?: AxiosAdapter) {
  const fixture = createSessionFixture([csrfReply(), successReply(testSession), ...replies], {
    adapter,
  });
  controllers.push(fixture.controller);
  fixture.controller.start();
  const access = await requireSessionAccess(fixture.controller);
  return { ...fixture, access, api: createTransferApi(fixture.privateApi, access) };
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('transfer and lookup adapters', () => {
  it('sends the reviewed payload and existing key once with bearer but no cookies or CSRF', async () => {
    const { api, adapter } = await setup([successReply(receipt)]);
    await expect(
      api.submit({ ...request, toEmail: ' Recipient@example.com ' }, key.toUpperCase()),
    ).resolves.toEqual(receipt);
    const config = adapter.mock.calls[2]?.[0];
    expect(config?.url).toBe('/api/v1/transfer');
    expect(config?.method).toBe('post');
    expect(config?.data).toBe(JSON.stringify(request));
    expect(config?.headers.get('Idempotency-Key')).toBe(key);
    expect(config?.headers.get('Authorization')).toBe('Bearer test-access');
    expect(config?.headers.get('X-XSRF-TOKEN')).toBeUndefined();
    expect(config?.withCredentials).toBe(false);
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it('preserves the maximum amount on the wire and in a receipt', async () => {
    const amount = '50000000';
    const { api, adapter } = await setup([successReply({ ...receipt, amount })]);
    await expect(api.submit({ ...request, amount }, key)).resolves.toMatchObject({ amount });
    expect(adapter.mock.calls[2]?.[0].data).toBe(JSON.stringify({ ...request, amount }));
  });

  it('blocks invalid keys, amounts and payload fields before sending', async () => {
    const { api, adapter } = await setup([]);
    await expect(api.submit(request, '../auth/logout')).rejects.toMatchObject({ kind: 'client' });
    await expect(api.getRequest(`${key}?token=secret`)).rejects.toMatchObject({ kind: 'client' });
    await expect(api.submit({ ...request, amount: '1000.001' }, key)).rejects.toMatchObject({
      kind: 'client',
    });
    await expect(api.submit({ ...request, amount: '50000001' }, key)).rejects.toMatchObject({
      kind: 'client',
    });
    await expect(
      api.submit({ ...request, description: 'x'.repeat(256) }, key),
    ).rejects.toMatchObject({ kind: 'client' });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['TOKEN_EXPIRED', 401],
    ['ACCOUNT_LOCKED', 403],
    ['RECIPIENT_NOT_FOUND', 404],
    ['IDEMPOTENCY_KEY_REUSED', 409],
    ['TRANSFER_IN_PROGRESS', 409],
    ['CONCURRENT_MODIFICATION', 409],
    ['LEGACY_FRACTIONAL_MONEY', 409],
    ['INTERNAL_SERVER_ERROR', 500],
  ] as const)(
    'does not refresh, replay or look up automatically after %s',
    async (code, status) => {
      const { api, adapter } = await setup([errorReply(code, status)]);
      const error = await api.submit(request, key).catch((caught: unknown) => caught);
      expect(error).toMatchObject({ code, status });
      expect(String(error)).not.toContain('Raw server text');
      expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
        '/api/v1/auth/csrf',
        '/api/v1/auth/refresh',
        '/api/v1/transfer',
      ]);
    },
  );

  it.each([
    new AxiosError('sensitive transfer payload', 'ECONNABORTED'),
    new AxiosError('sensitive transfer payload', 'ERR_NETWORK'),
    new CanceledError('sensitive transfer payload'),
  ])('keeps transport failures unknown without replay or raw payload leakage', async (failure) => {
    const { api, adapter } = await setup([failure]);
    const error = await api.submit(request, key).catch((caught: unknown) => caught);
    expect(error).toHaveProperty('kind');
    expect(error).not.toHaveProperty('config');
    expect(String(error)).not.toContain('sensitive transfer payload');
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it('rejects mismatched or malformed receipts instead of declaring success', async () => {
    const { api } = await setup([
      successReply({ ...receipt, amount: '2000' }),
      successReply({ ...receipt, amount: 1000.5 }),
      successReply({ ...receipt, status: 'FAILED' }),
    ]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(api.submit(request, key)).rejects.toMatchObject({ kind: 'protocol' });
    }
  });

  it('returns each lookup state, sanitizes stored errors and never executes a transfer from GET', async () => {
    const { api, adapter } = await setup([
      successReply(pending),
      successReply({ ...pending, state: 'SUCCEEDED', result: receipt }),
      successReply({
        ...pending,
        state: 'REJECTED',
        error: { httpStatus: 400, code: 'RECIPIENT_LOCKED', message: 'internal recipient details' },
      }),
    ]);
    await expect(api.getRequest(key)).resolves.toMatchObject({ state: 'PENDING' });
    await expect(api.getRequest(key)).resolves.toMatchObject({
      state: 'SUCCEEDED',
      result: receipt,
    });
    const rejected = await api.getRequest(key);
    expect(rejected).toMatchObject({ state: 'REJECTED', error: { code: 'RECIPIENT_LOCKED' } });
    expect(JSON.stringify(rejected)).not.toContain('internal recipient details');
    for (const [config] of adapter.mock.calls.slice(2)) {
      expect(config.method).toBe('get');
      expect(config.url).toBe(`/api/v1/transfer/requests/${key}`);
      expect(config.headers.get('Idempotency-Key')).toBeUndefined();
    }
  });

  it('rejects lookup for another key and preserves 404 as a lookup error, not a failed transfer', async () => {
    const { api, adapter } = await setup([
      successReply({ ...pending, idempotencyKey: '550e8400-e29b-41d4-a716-446655440001' }),
      errorReply('TRANSFER_REQUEST_NOT_FOUND', 404),
    ]);
    await expect(api.getRequest(key)).rejects.toMatchObject({ kind: 'protocol' });
    await expect(api.getRequest(key)).rejects.toMatchObject({
      code: 'TRANSFER_REQUEST_NOT_FOUND',
      message: expect.stringContaining('does not confirm'),
    });
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it('reads exact legacy money but blocks submitting the historical fractional payload', async () => {
    const historicalRequest = { ...request, amount: '1000.50' };
    const historicalReceipt = { ...receipt, amount: '1000.50', fromWalletBalance: '0.25' };
    const { api, adapter } = await setup([
      successReply({
        ...pending,
        state: 'SUCCEEDED',
        request: historicalRequest,
        result: historicalReceipt,
        legacyFractional: true,
      }),
    ]);
    await expect(api.getRequest(key)).resolves.toMatchObject({
      result: historicalReceipt,
      legacyFractional: true,
    });
    await expect(api.submit(historicalRequest, key)).rejects.toMatchObject({ kind: 'client' });
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it('retains the private read policy of one refresh and retry for expired lookup auth', async () => {
    const { api, adapter } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply(testSession),
      successReply(pending),
    ]);
    await expect(api.getRequest(key)).resolves.toMatchObject({ state: 'PENDING' });
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      `/api/v1/transfer/requests/${key}`,
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      `/api/v1/transfer/requests/${key}`,
    ]);
  });

  it('blocks old account adapters and already-aborted submissions before business dispatch', async () => {
    const { api, adapter, hub } = await setup([]);
    const abort = new AbortController();
    abort.abort();
    await expect(api.submit(request, key, abort.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    });
    const otherTab = hub.connect();
    await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    await expect(api.getRequest(key)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(api.submit(request, key)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('discards a successful receipt arriving after the account scope was invalidated', async () => {
    let release: () => void = () => undefined;
    let markSubmitted: () => void = () => undefined;
    const pendingResponse = new Promise<void>((resolve) => {
      release = resolve;
    });
    const submitted = new Promise<void>((resolve) => {
      markSubmitted = resolve;
    });
    const base = createApiAdapter([csrfReply(), successReply(testSession), successReply(receipt)]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === '/api/v1/transfer') {
        markSubmitted();
        await pendingResponse;
      }
      return base(config);
    };
    const { api, hub } = await setup([], delayed);
    const result = api.submit(request, key).catch((error: unknown) => error);
    try {
      await submitted;
      const otherTab = hub.connect();
      await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    } finally {
      release();
    }
    expect(await result).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(base).toHaveBeenCalledTimes(3);
  });
});
