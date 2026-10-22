import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { ApiError } from '@/shared/api/api-error';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import type { createDepositApi } from '../api/deposit-api';
import { depositOrderSchema } from '../api/deposit-schemas';
import {
  depositGatewayConfig,
  depositKey,
  makeDepositOrder,
} from '../api/deposit-fixture.test-support';
import {
  bindDepositMarkerCleanup,
  createDepositMarkerStore,
  DEPOSIT_MARKER_KEY,
} from './deposit-marker';
import { createDepositSubmission } from './deposit-submission';

const controllers: SessionController[] = [];
const cleanup: Array<() => void> = [];
const pendingOrder = () => depositOrderSchema.parse(makeDepositOrder());
async function setup(stored: string | null = null) {
  const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
  controllers.push(fixture.controller);
  fixture.controller.start();
  const access = await requireSessionAccess(fixture.controller);
  let value = stored;
  const storage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((...args: [string, string]) => {
      value = args[1];
    }),
    removeItem: vi.fn(() => {
      value = null;
    }),
  };
  const markers = createDepositMarkerStore(() => storage);
  cleanup.push(bindDepositMarkerCleanup(fixture.controller, markers));
  type Api = ReturnType<typeof createDepositApi>;
  const api = {
    submit: vi.fn<Api['submit']>(async () => pendingOrder()),
    getRequest: vi.fn<Api['getRequest']>(async () => pendingOrder()),
  };
  const openPayment = vi.fn<(url: string) => void>();
  const openResult = vi.fn<(orderId: string) => void>();
  const newKey = vi.fn(() => depositKey);
  const operation = createDepositSubmission({
    session: fixture.controller,
    access,
    api,
    markers,
    gateway: depositGatewayConfig,
    openPayment,
    openResult,
    newKey,
  });
  cleanup.push(operation.stop);
  operation.start();
  return { ...fixture, operation, api, markers, storage, newKey, openPayment, openResult };
}

afterEach(async () => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('top-up creation and recovery', () => {
  it('persists only owner/key before one POST and opens a validated link in the same intent', async () => {
    const f = await setup();
    f.api.submit.mockImplementationOnce(async () => {
      expect(f.markers.read()).toEqual({ userId: 1, idempotencyKey: depositKey });
      return pendingOrder();
    });
    await Promise.all([f.operation.submit(50000), f.operation.submit(50000)]);
    expect(f.api.submit).toHaveBeenCalledTimes(1);
    expect(f.api.submit).toHaveBeenCalledWith(
      { amount: 50000 },
      depositKey,
      expect.any(AbortSignal),
    );
    expect(f.storage.setItem).toHaveBeenCalledWith(
      DEPOSIT_MARKER_KEY,
      JSON.stringify({ userId: 1, idempotencyKey: depositKey }),
    );
    expect(f.openPayment).toHaveBeenCalledWith(makeDepositOrder().paymentUrl);
    expect(f.openResult).not.toHaveBeenCalled();
    expect(f.markers.read()).not.toBeNull();
  });

  it.each(['timeout', 'network', 'protocol', 'cancelled'] as const)(
    'keeps an uncertain %s request and only GETs after an explicit check',
    async (kind) => {
      const f = await setup();
      f.api.submit.mockRejectedValueOnce(new ApiError(kind));
      await f.operation.submit(50000);
      expect(f.operation.getSnapshot().status).toBe('unknown');
      expect(f.api.getRequest).not.toHaveBeenCalled();
      expect(f.openPayment).not.toHaveBeenCalled();
      await Promise.all([f.operation.checkStatus(), f.operation.checkStatus()]);
      expect(f.api.getRequest).toHaveBeenCalledTimes(1);
      expect(f.api.submit).toHaveBeenCalledTimes(1);
      expect(f.openResult).toHaveBeenCalledWith(makeDepositOrder().orderId);
      expect(f.openPayment).not.toHaveBeenCalled();
    },
  );

  it('offers same-key confirmation after 404 only while the original amount is in memory', async () => {
    const f = await setup();
    f.api.submit.mockRejectedValueOnce(new ApiError('timeout'));
    await f.operation.submit(50000);
    f.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', {
        status: 404,
        code: 'DEPOSIT_REQUEST_NOT_FOUND',
      }),
    );
    await f.operation.checkStatus();
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'unknown', canResume: true });
    f.operation.reviewResume();
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'resume-review', amount: 50000 });
    f.operation.cancelResume();
    expect(f.api.submit).toHaveBeenCalledTimes(1);
    f.operation.reviewResume();
    await Promise.all([f.operation.resume(), f.operation.resume()]);
    expect(f.api.submit).toHaveBeenCalledTimes(2);
    expect(f.api.submit).toHaveBeenLastCalledWith(
      { amount: 50000 },
      depositKey,
      expect.any(AbortSignal),
    );
    expect(f.newKey).toHaveBeenCalledTimes(1);
  });

  it('restores only a marker without automatically POSTing, GETing or opening the gateway', async () => {
    const f = await setup(JSON.stringify({ userId: 1, idempotencyKey: depositKey }));
    expect(f.operation.getSnapshot().status).toBe('unknown');
    expect(f.api.submit).not.toHaveBeenCalled();
    expect(f.api.getRequest).not.toHaveBeenCalled();
    f.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', {
        status: 404,
        code: 'DEPOSIT_REQUEST_NOT_FOUND',
      }),
    );
    await f.operation.checkStatus();
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'unknown', canResume: false });
    f.operation.reviewResume();
    await f.operation.submit(10000);
    await f.operation.resume();
    expect(f.api.submit).not.toHaveBeenCalled();
    expect(f.openPayment).not.toHaveBeenCalled();
  });

  it.each(['DEPOSIT_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID', 'LEGACY_FRACTIONAL_MONEY'])(
    'does not bypass %s with a new key or replay',
    async (code) => {
      const f = await setup();
      f.api.submit.mockRejectedValueOnce(new ApiError('business', { code, status: 409 }));
      await f.operation.submit(50000);
      f.api.getRequest.mockRejectedValueOnce(
        new ApiError('business', {
          status: 404,
          code: 'DEPOSIT_REQUEST_NOT_FOUND',
        }),
      );
      await f.operation.checkStatus();
      f.operation.reviewResume();
      await f.operation.resume();
      await f.operation.submit(10000);
      expect(f.api.submit).toHaveBeenCalledTimes(1);
      expect(f.newKey).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks POST when marker persistence fails or contains invalid data', async () => {
    const f = await setup();
    f.storage.setItem.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    await f.operation.submit(50000);
    expect(f.api.submit).not.toHaveBeenCalled();
    const invalid = await setup('{bad json');
    await invalid.operation.submit(50000);
    expect(invalid.api.submit).not.toHaveBeenCalled();
    expect(invalid.operation.getSnapshot().status).toBe('blocked');
  });

  it('returns fresh validation failure to editing, but never clears an uncertain replay', async () => {
    const f = await setup();
    f.api.submit.mockRejectedValueOnce(
      new ApiError('business', { status: 400, code: 'VALIDATION_ERROR' }),
    );
    await f.operation.submit(50000);
    expect(f.markers.read()).toBeNull();
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'idle', draftAmount: '50000' });
    f.api.submit.mockRejectedValueOnce(new ApiError('timeout'));
    await f.operation.submit(50000);
    f.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', { status: 404, code: 'DEPOSIT_REQUEST_NOT_FOUND' }),
    );
    await f.operation.checkStatus();
    f.operation.reviewResume();
    f.api.submit.mockRejectedValueOnce(
      new ApiError('business', { status: 400, code: 'VALIDATION_ERROR' }),
    );
    await f.operation.resume();
    expect(f.markers.read()).not.toBeNull();
    expect(f.operation.getSnapshot().status).toBe('unknown');
  });

  it.each(['SUCCESS', 'FAILED', 'PENDING'] as const)(
    'routes a non-payable %s order to result without treating expiry as failure',
    async (status) => {
      const f = await setup();
      f.api.submit.mockResolvedValueOnce({
        ...pendingOrder(),
        status,
        canContinuePayment: false,
        paymentUrl: null,
      });
      await f.operation.submit(50000);
      expect(f.openPayment).not.toHaveBeenCalled();
      expect(f.openResult).toHaveBeenCalledWith(makeDepositOrder().orderId);
      expect(f.markers.read() === null).toBe(status !== 'PENDING');
    },
  );

  it('never opens an unsafe payment URL', async () => {
    const f = await setup();
    f.api.submit.mockResolvedValueOnce({ ...pendingOrder(), paymentUrl: 'https://evil.test' });
    await f.operation.submit(50000);
    expect(f.openPayment).not.toHaveBeenCalled();
    expect(f.operation.getSnapshot().status).toBe('unknown');
    expect(f.markers.read()).not.toBeNull();
  });

  it('does not redirect a response with different request details', async () => {
    const f = await setup();
    f.api.submit.mockResolvedValueOnce({ ...pendingOrder(), amount: 10000 });
    await f.operation.submit(50000);
    expect(f.openPayment).not.toHaveBeenCalled();
    expect(f.openResult).not.toHaveBeenCalled();
    expect(f.operation.getSnapshot().status).toBe('unknown');
  });

  it('keeps the order accessible when navigation or terminal marker cleanup fails', async () => {
    const f = await setup();
    f.api.submit.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'SUCCESS',
      canContinuePayment: false,
      paymentUrl: null,
    });
    f.storage.removeItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    f.openResult.mockImplementation(() => {
      throw new Error('navigation unavailable');
    });
    await f.operation.submit(50000);
    expect(f.operation.getSnapshot()).toMatchObject({
      status: 'known',
      orderId: makeDepositOrder().orderId,
    });
    expect(f.markers.read()).not.toBeNull();
    await f.operation.submit(10000);
    expect(f.api.submit).toHaveBeenCalledTimes(1);
  });

  it('retains the recovery marker after access rejection without replaying the command', async () => {
    const f = await setup();
    f.api.submit.mockRejectedValueOnce(
      new ApiError('business', {
        status: 401,
        code: 'TOKEN_EXPIRED',
      }),
    );
    await f.operation.submit(50000);
    expect(f.operation.getSnapshot().status).toBe('unknown');
    const access = f.controller.getAccessIdentity();
    if (!access) throw new Error('Expected an authenticated fixture');
    await f.controller.rejectAccess(access.epoch, 'test-access');
    expect(f.operation.getSnapshot().status).toBe('blocked');
    expect(f.markers.read()).not.toBeNull();
    expect(f.api.submit).toHaveBeenCalledTimes(1);
    expect(f.api.getRequest).not.toHaveBeenCalled();
  });

  it('ignores late creation after unmount and StrictMode restart without repeating the POST', async () => {
    const f = await setup();
    let release: () => void = () => undefined;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.api.submit.mockImplementationOnce(async () => {
      await delay;
      return pendingOrder();
    });
    const work = f.operation.submit(50000);
    f.operation.stop();
    f.operation.start();
    release();
    await work;
    expect(f.operation.getSnapshot().status).toBe('unknown');
    expect(f.api.submit).toHaveBeenCalledTimes(1);
    expect(f.openPayment).not.toHaveBeenCalled();
    expect(f.openResult).not.toHaveBeenCalled();
  });

  it('aborts a request and removes the marker and amount on cross-tab logout', async () => {
    const f = await setup();
    let release: () => void = () => undefined;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.api.submit.mockImplementationOnce(async () => {
      await delay;
      return pendingOrder();
    });
    const work = f.operation.submit(50000);
    const other = f.hub.connect();
    await other.change(() => ({ version: 1, epoch: other.newEpoch(), mode: 'signed-out' }));
    release();
    await work;
    expect(f.api.submit.mock.calls[0]?.[2]?.aborted).toBe(true);
    expect(f.markers.read()).toBeNull();
    expect(f.operation.getSnapshot().status).toBe('blocked');
    expect(f.openPayment).not.toHaveBeenCalled();
  });
});
