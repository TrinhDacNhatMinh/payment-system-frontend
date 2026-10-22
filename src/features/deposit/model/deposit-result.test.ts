import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { ApiError } from '@/shared/api/api-error';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import {
  depositGatewayConfig,
  depositKey,
  makeDepositOrder,
} from '../api/deposit-fixture.test-support';
import { depositOrderSchema, type DepositOrder } from '../api/deposit-schemas';
import { createDepositMarkerStore } from './deposit-marker';
import { createDepositResult } from './deposit-result';
import { createDepositSubmission } from './deposit-submission';

const controllers: SessionController[] = [];
const stops: Array<() => void> = [];
const pendingOrder = () => depositOrderSchema.parse(makeDepositOrder());

async function setup(options: { visible?: boolean; online?: boolean; configured?: boolean } = {}) {
  const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
  controllers.push(fixture.controller);
  fixture.controller.start();
  const access = await requireSessionAccess(fixture.controller);
  let stored: string | null = JSON.stringify({ userId: 1, idempotencyKey: depositKey });
  const storage = {
    getItem: () => stored,
    setItem: (...args: [string, string]) => {
      stored = args[1];
    },
    removeItem: vi.fn(() => {
      stored = null;
    }),
  };
  const markers = createDepositMarkerStore(() => storage);
  const readOrder = vi.fn<(id: string, signal: AbortSignal) => Promise<DepositOrder>>(async () =>
    pendingOrder(),
  );
  const refreshWallet = vi.fn(async () => undefined);
  const invalidateHistory = vi.fn(async () => undefined);
  const openPayment = vi.fn<(url: string) => void>();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const operation = createDepositResult({
    session: fixture.controller,
    access,
    orderId: pendingOrder().orderId,
    readOrder,
    markers,
    refreshWallet,
    invalidateHistory,
    openPayment,
    gateway: options.configured === false ? null : depositGatewayConfig,
  });
  stops.push(operation.stop);
  operation.start(options.visible ?? true, options.online ?? true);
  return {
    ...fixture,
    operation,
    readOrder,
    refreshWallet,
    invalidateHistory,
    openPayment,
    markers,
    storage,
  };
}

afterEach(async () => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('order result polling and continuation', () => {
  it('keeps a confirmed top-up when history invalidation fails and still refreshes the wallet', async () => {
    const f = await setup();
    f.invalidateHistory.mockRejectedValueOnce(new Error('History unavailable'));
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'SUCCESS',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.invalidateHistory).toHaveBeenCalledTimes(1);
    expect(f.refreshWallet).toHaveBeenCalledTimes(1);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'success', wallet: 'ready' });
  });

  it('does not invalidate history for a pending or failed order', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.invalidateHistory).not.toHaveBeenCalled();
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'FAILED',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.operation.getSnapshot().status).toBe('failed');
    expect(f.invalidateHistory).not.toHaveBeenCalled();
  });

  it('allows a new top-up after a pending order is known without overwriting a newer request', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', canStartNew: true });
    expect(f.markers.read()).toBeNull();
    const access = f.controller.getAccessIdentity();
    if (!access) throw new Error('Expected an authenticated fixture');
    const api = {
      submit: vi.fn(async () => {
        throw new ApiError('timeout');
      }),
      getRequest: vi.fn(async () => pendingOrder()),
    };
    const next = createDepositSubmission({
      session: f.controller,
      access,
      api,
      markers: f.markers,
      gateway: depositGatewayConfig,
      newKey: () => '650e8400-e29b-41d4-a716-446655440000',
      openPayment: vi.fn(),
      openResult: vi.fn(),
    });
    stops.push(next.stop);
    next.start();
    expect(next.getSnapshot().status).toBe('idle');
    await next.submit(50000);
    expect(api.submit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.markers.read()?.idempotencyKey).toBe('650e8400-e29b-41d4-a716-446655440000');
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', canStartNew: false });
  });

  it('reads at 0 then every two seconds, at most 30 reads, and keeps PENDING after the budget', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.readOrder).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.readOrder).toHaveBeenCalledTimes(30);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', automatic: false });
    expect(f.markers.read()).toBeNull();
    expect(f.refreshWallet).not.toHaveBeenCalled();
    expect(f.openPayment).not.toHaveBeenCalled();
    await f.operation.checkStatus();
    expect(f.readOrder).toHaveBeenCalledTimes(31);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.readOrder).toHaveBeenCalledTimes(31);
  });

  it('pauses both GET and the visible-time budget while the tab is hidden', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(20000);
    const before = f.readOrder.mock.calls.length;
    f.operation.wake(false, true);
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.readOrder).toHaveBeenCalledTimes(before);
    f.operation.wake(true, true);
    await vi.advanceTimersByTimeAsync(40000);
    expect(f.readOrder).toHaveBeenCalledTimes(30);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', automatic: false });
  });

  it('does not read while initially hidden, and starts verification when shown', async () => {
    const f = await setup({ visible: false });
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.readOrder).not.toHaveBeenCalled();
    f.operation.wake(true, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.readOrder).toHaveBeenCalledTimes(1);
  });

  it('counts visible offline time and never renews the budget on reconnect', async () => {
    const f = await setup({ online: false });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.readOrder).not.toHaveBeenCalled();
    f.operation.wake(true, true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.readOrder).not.toHaveBeenCalled();
    await f.operation.checkStatus();
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', automatic: false });
  });

  it('keeps one request in flight and does not catch up after a slow response', async () => {
    const f = await setup();
    let resolve: (order: DepositOrder) => void = () => undefined;
    f.readOrder.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    await Promise.all([f.operation.checkStatus(), f.operation.continuePayment()]);
    await vi.advanceTimersByTimeAsync(70000);
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    resolve(pendingOrder());
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', automatic: false });
    expect(f.openPayment).not.toHaveBeenCalled();
  });

  it.each(['network', 'timeout', 'protocol'] as const)(
    'stops polling on %s and uses a single manual read without restarting automatic checks',
    async (kind) => {
      const f = await setup();
      f.readOrder.mockRejectedValueOnce(new ApiError(kind));
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.readOrder).toHaveBeenCalledTimes(1);
      expect(f.operation.getSnapshot().status).toBe('unavailable');
      await f.operation.checkStatus();
      expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending', automatic: false });
      await vi.advanceTimersByTimeAsync(10000);
      expect(f.readOrder).toHaveBeenCalledTimes(2);
    },
  );

  it.each([401, 403, 404, 500])(
    'does not call an HTTP %s error a failed payment',
    async (status) => {
      const f = await setup();
      f.readOrder.mockRejectedValueOnce(
        new ApiError('business', { status, code: 'PAYMENT_ORDER_NOT_FOUND' }),
      );
      await vi.advanceTimersByTimeAsync(60000);
      expect(f.operation.getSnapshot().status).toBe('unavailable');
      expect(f.readOrder).toHaveBeenCalledTimes(1);
      expect(f.markers.read()).not.toBeNull();
      expect(f.refreshWallet).not.toHaveBeenCalled();
    },
  );

  it('confirms success, clears only its marker and refreshes the wallet once', async () => {
    const f = await setup();
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'SUCCESS',
      paidAt: '2026-10-22T10:05:00',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.operation.getSnapshot()).toMatchObject({
      status: 'success',
      wallet: 'ready',
      canStartNew: true,
    });
    expect(f.markers.read()).toBeNull();
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    expect(f.refreshWallet).toHaveBeenCalledTimes(1);
  });

  it('stops polling immediately after pending becomes successful', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(0);
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'SUCCESS',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'success', wallet: 'ready' });
    expect(f.readOrder).toHaveBeenCalledTimes(2);
    expect(f.refreshWallet).toHaveBeenCalledTimes(1);
  });

  it('does not show or act on a response for a different order', async () => {
    const f = await setup();
    f.readOrder.mockResolvedValueOnce({ ...pendingOrder(), orderId: 'VNPAY_OTHER' });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.operation.getSnapshot().status).toBe('unavailable');
    expect(f.markers.read()).not.toBeNull();
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    expect(f.refreshWallet).not.toHaveBeenCalled();
    expect(f.openPayment).not.toHaveBeenCalled();
  });

  it('retains confirmed success on wallet failure and allows an explicit balance retry', async () => {
    const f = await setup();
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'SUCCESS',
      canContinuePayment: false,
      paymentUrl: null,
    });
    f.refreshWallet.mockRejectedValueOnce(new Error('wallet unavailable'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'success', wallet: 'error' });
    await f.operation.retryWallet();
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'success', wallet: 'ready' });
    expect(f.readOrder).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmed failure separate from expired PENDING and never refreshes the wallet for failure', async () => {
    const f = await setup();
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'FAILED',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(f.operation.getSnapshot().status).toBe('failed');
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    expect(f.refreshWallet).not.toHaveBeenCalled();
  });

  it('preserves a different recovery marker even when this order is terminal', async () => {
    const f = await setup();
    const different = { userId: 1, idempotencyKey: '650e8400-e29b-41d4-a716-446655440000' };
    f.markers.clearAll();
    f.markers.save(different);
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'FAILED',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'failed', canStartNew: false });
    expect(f.markers.read()).toEqual(different);
  });

  it('keeps terminal results when storage cleanup fails', async () => {
    const f = await setup();
    f.storage.removeItem.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      status: 'FAILED',
      canContinuePayment: false,
      paymentUrl: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'failed', canStartNew: false });
    expect(f.markers.read()).not.toBeNull();
  });

  it('uses a fresh GET for explicit continuation and never opens the gateway from polling', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.openPayment).not.toHaveBeenCalled();
    await Promise.all([f.operation.continuePayment(), f.operation.continuePayment()]);
    expect(f.readOrder).toHaveBeenCalledTimes(2);
    expect(f.openPayment).toHaveBeenCalledTimes(1);
    expect(f.openPayment).toHaveBeenCalledWith(pendingOrder().paymentUrl);
  });

  it('does not open an expired or unsafe link after re-reading the order', async () => {
    const f = await setup();
    await vi.advanceTimersByTimeAsync(0);
    f.readOrder.mockResolvedValueOnce({
      ...pendingOrder(),
      canContinuePayment: false,
      paymentUrl: null,
    });
    await f.operation.continuePayment();
    expect(f.operation.getSnapshot()).toMatchObject({ status: 'pending' });
    expect(f.openPayment).not.toHaveBeenCalled();
    f.readOrder.mockResolvedValueOnce({ ...pendingOrder(), paymentUrl: 'https://evil.test' });
    await f.operation.checkStatus();
    expect(f.operation.getSnapshot().status).toBe('unavailable');
    expect(f.openPayment).not.toHaveBeenCalled();
  });

  it('reads status without gateway config but cannot redirect to payment', async () => {
    const f = await setup({ configured: false });
    await vi.advanceTimersByTimeAsync(0);
    await f.operation.continuePayment();
    expect(f.operation.getSnapshot().status).toBe('pending');
    expect(f.openPayment).not.toHaveBeenCalled();
  });

  it('discards a late response on logout and never refreshes the old wallet', async () => {
    const f = await setup();
    let resolve: (order: DepositOrder) => void = () => undefined;
    f.readOrder.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const other = f.hub.connect();
    await other.change(() => ({ version: 1, epoch: other.newEpoch(), mode: 'signed-out' }));
    expect(f.readOrder.mock.calls[0]?.[1].aborted).toBe(true);
    resolve({ ...pendingOrder(), status: 'SUCCESS', canContinuePayment: false, paymentUrl: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.operation.getSnapshot().status).toBe('blocked');
    expect(f.refreshWallet).not.toHaveBeenCalled();
    expect(f.openPayment).not.toHaveBeenCalled();
  });

  it('cleans timers on unmount and survives StrictMode setup/cleanup/setup before the first read', async () => {
    const f = await setup();
    f.operation.stop();
    f.operation.start(true, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.readOrder).toHaveBeenCalledTimes(1);
    f.operation.stop();
    await vi.advanceTimersByTimeAsync(120000);
    expect(f.readOrder).toHaveBeenCalledTimes(1);
  });
});
