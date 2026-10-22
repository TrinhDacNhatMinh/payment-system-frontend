import { AxiosError, type AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { createApiAdapter, errorReply, successReply, type ApiReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { createDepositApi } from './deposit-api';
import { depositGatewayConfig, depositKey, makeDepositOrder } from './deposit-fixture.test-support';

const controllers: SessionController[] = [];
async function setup(replies: ApiReply[], adapter?: AxiosAdapter) {
  const fixture = createSessionFixture([csrfReply(), successReply(testSession), ...replies], {
    adapter,
  });
  controllers.push(fixture.controller);
  fixture.controller.start();
  const access = await requireSessionAccess(fixture.controller);
  return {
    ...fixture,
    api: createDepositApi(fixture.privateApi, access, depositGatewayConfig),
  };
}

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('deposit private API adapters', () => {
  it('sends one numeric request with the caller key, bearer and no cookies or CSRF', async () => {
    const view = makeDepositOrder();
    const { api, adapter } = await setup([successReply(view)]);
    await expect(api.submit({ amount: 50000 }, depositKey.toUpperCase())).resolves.toEqual(view);
    const config = adapter.mock.calls[2]?.[0];
    expect(config?.url).toBe('/api/v1/payment/deposit');
    expect(config?.method).toBe('post');
    expect(config?.data).toBe('{"amount":50000}');
    expect(config?.headers.get('Idempotency-Key')).toBe(depositKey);
    expect(config?.headers.get('Authorization')).toBe('Bearer test-access');
    expect(config?.headers.get('X-XSRF-TOKEN')).toBeUndefined();
    expect(config?.withCredentials).toBe(false);
    expect(adapter).toHaveBeenCalledTimes(3);
  });

  it.each([10000, 50000000])(
    'preserves numeric amount %s on the wire and checks the link amount',
    async (amount) => {
      const view = makeDepositOrder();
      const url = new URL(view.paymentUrl);
      url.searchParams.set('vnp_Amount', (BigInt(amount) * 100n).toString());
      const { api, adapter } = await setup([
        successReply({ ...view, amount, paymentUrl: url.href }),
      ]);
      await expect(api.submit({ amount }, depositKey)).resolves.toMatchObject({ amount });
      expect(adapter.mock.calls[2]?.[0].data).toBe(JSON.stringify({ amount }));
    },
  );

  it('validates input keys, IDs, fields and amounts before business dispatch', async () => {
    const { api, adapter } = await setup([]);
    await expect(api.submit({ amount: 9999 }, depositKey)).rejects.toMatchObject({
      kind: 'client',
    });
    await expect(api.submit({ amount: 10000 }, 'bad-key')).rejects.toMatchObject({
      kind: 'client',
    });
    await expect(api.getOrder('../auth/logout')).rejects.toMatchObject({ kind: 'client' });
    await expect(api.getOrder('VNPAY_1?token=secret')).rejects.toMatchObject({ kind: 'client' });
    await expect(api.getRequest(depositKey + '/other')).rejects.toMatchObject({ kind: 'client' });
    const extra = { amount: 10000, userId: 2 };
    await expect(api.submit(extra, depositKey)).rejects.toMatchObject({ kind: 'client' });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('reads the requested order and key without ever sending a create request or key header', async () => {
    const view = {
      ...makeDepositOrder(),
      status: 'SUCCESS',
      canContinuePayment: false,
      paymentUrl: null,
    };
    const { api, adapter } = await setup([successReply(view), successReply(view)]);
    await expect(api.getOrder(view.orderId)).resolves.toEqual(view);
    await expect(api.getRequest(depositKey)).resolves.toEqual(view);
    expect(adapter.mock.calls.slice(2).map(([config]) => config.url)).toEqual([
      `/api/v1/payment/orders/${view.orderId}`,
      `/api/v1/payment/deposit/requests/${depositKey}`,
    ]);
    for (const [config] of adapter.mock.calls.slice(2)) {
      expect(config.method).toBe('get');
      expect(config.headers.get('Idempotency-Key')).toBeUndefined();
    }
  });

  it('reads an expired pending view and a legacy terminal view without fabricating a new link', async () => {
    const expired = { ...makeDepositOrder(), canContinuePayment: false, paymentUrl: null };
    const legacy = {
      ...expired,
      status: 'SUCCESS',
      idempotencyKey: null,
      paymentUrlExpiresAt: null,
      amount: 50000001,
    };
    const { api, adapter } = await setup([successReply(expired), successReply(legacy)]);
    await expect(api.getRequest(depositKey)).resolves.toMatchObject({
      status: 'PENDING',
      paymentUrl: null,
    });
    await expect(api.getOrder(legacy.orderId)).resolves.toMatchObject({
      amount: 50000001,
      idempotencyKey: null,
    });
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['TOKEN_EXPIRED', 401],
    ['ACCOUNT_LOCKED', 403],
    ['DEPOSIT_KEY_REUSED', 409],
    ['DEPOSIT_REQUEST_IN_PROGRESS', 409],
    ['VALIDATION_ERROR', 400],
    ['IDEMPOTENCY_KEY_INVALID', 400],
    ['AMOUNT_OUT_OF_RANGE', 400],
    ['LEGACY_FRACTIONAL_MONEY', 409],
    ['INTERNAL_SERVER_ERROR', 500],
  ] as const)(
    'does not replay or look up automatically after create error %s',
    async (code, status) => {
      const { api, adapter } = await setup([errorReply(code, status)]);
      const failure = await api
        .submit({ amount: 50000 }, depositKey)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ code, status });
      expect(String(failure)).not.toContain('Raw server text');
      expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
        '/api/v1/auth/csrf',
        '/api/v1/auth/refresh',
        '/api/v1/payment/deposit',
      ]);
    },
  );

  it.each(['ECONNABORTED', 'ERR_NETWORK'])(
    'does not retry transport failure %s or expose request/response data',
    async (code) => {
      const { api, adapter } = await setup([new AxiosError('sensitive signed URL', code)]);
      const failure = await api
        .submit({ amount: 50000 }, depositKey)
        .catch((error: unknown) => error);
      expect(failure).toMatchObject({ kind: code === 'ECONNABORTED' ? 'timeout' : 'network' });
      expect(failure).not.toHaveProperty('config');
      expect(String(failure)).not.toContain('sensitive signed URL');
      expect(adapter).toHaveBeenCalledTimes(3);
    },
  );

  it('rejects mismatched create data, lookup identities, inconsistent views and untrusted links', async () => {
    const view = makeDepositOrder();
    const wrongKey = '550e8400-e29b-41d4-a716-446655440001';
    const { api } = await setup([
      successReply({ ...view, amount: 10000 }),
      successReply({ ...view, idempotencyKey: wrongKey }),
      successReply({ ...view, orderId: 'VNPAY_OTHER' }),
      successReply({ ...view, idempotencyKey: wrongKey }),
      successReply({ ...view, status: 'SUCCESS' }),
      successReply({ ...view, paymentUrl: 'https://evil.test/payment' }),
    ]);
    await expect(api.submit({ amount: 50000 }, depositKey)).rejects.toMatchObject({
      kind: 'protocol',
    });
    await expect(api.submit({ amount: 50000 }, depositKey)).rejects.toMatchObject({
      kind: 'protocol',
    });
    await expect(api.getOrder(view.orderId)).rejects.toMatchObject({ kind: 'protocol' });
    await expect(api.getRequest(depositKey)).rejects.toMatchObject({ kind: 'protocol' });
    await expect(api.getOrder(view.orderId)).rejects.toMatchObject({ kind: 'protocol' });
    await expect(api.getOrder(view.orderId)).rejects.toMatchObject({ kind: 'protocol' });
  });

  it.each([
    ['DEPOSIT_REQUEST_NOT_FOUND', 'not visible yet'],
    ['PAYMENT_ORDER_NOT_FOUND', 'cannot be accessed'],
  ])(
    'sanitizes %s and does not infer failure or create a replacement order',
    async (code, message) => {
      const { api, adapter } = await setup([errorReply(code, 404)]);
      await expect(api.getRequest(depositKey)).rejects.toMatchObject({
        code,
        message: expect.stringContaining(message),
      });
      expect(adapter).toHaveBeenCalledTimes(3);
    },
  );

  it('allows one auth refresh/read retry for lookup while retaining the same key', async () => {
    const { api, adapter } = await setup([
      errorReply('TOKEN_EXPIRED', 401),
      csrfReply(),
      successReply({ ...testSession, accessToken: 'renewed' }),
      successReply(makeDepositOrder()),
    ]);
    await expect(api.getRequest(depositKey)).resolves.toMatchObject({ idempotencyKey: depositKey });
    expect(adapter.mock.calls.map(([config]) => config.url)).toEqual([
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      `/api/v1/payment/deposit/requests/${depositKey}`,
      '/api/v1/auth/csrf',
      '/api/v1/auth/refresh',
      `/api/v1/payment/deposit/requests/${depositKey}`,
    ]);
    expect(adapter.mock.calls[5]?.[0].headers.get('Authorization')).toBe('Bearer renewed');
  });

  it('blocks already-aborted requests and an old session before dispatch', async () => {
    const { api, adapter, hub } = await setup([]);
    const abort = new AbortController();
    abort.abort();
    await expect(api.submit({ amount: 50000 }, depositKey, abort.signal)).rejects.toMatchObject({
      kind: 'cancelled',
    });
    const otherTab = hub.connect();
    await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    await expect(api.getRequest(depositKey)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(api.submit({ amount: 50000 }, depositKey)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('discards a late lookup view after cross-tab logout', async () => {
    let release: () => void = () => undefined;
    let started: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatched = new Promise<void>((resolve) => {
      started = resolve;
    });
    const base = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      successReply(makeDepositOrder()),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url?.startsWith('/api/v1/payment/deposit/requests/')) {
        started();
        await waiting;
      }
      return base(config);
    };
    const { api, hub } = await setup([], delayed);
    const work = api.getRequest(depositKey).catch((error: unknown) => error);
    try {
      await dispatched;
      const otherTab = hub.connect();
      await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    } finally {
      release();
    }
    expect(await work).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(base).toHaveBeenCalledTimes(3);
  });
});
