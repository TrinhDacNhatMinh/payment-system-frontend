import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { ApiError } from '@/shared/api/api-error';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import type { createTransferApi } from '../api/transfer-api';
import type { TransferLookup } from '../api/transfer-schemas';
import {
  bindTransferMarkerCleanup,
  createTransferMarkerStore,
  TRANSFER_MARKER_KEY,
} from './transfer-marker';
import { createTransferSubmission } from './transfer-submission';

const key = '550e8400-e29b-41d4-a716-446655440000';
const payload = { toEmail: 'Other@example.com', amount: '1000', description: '  lunch  ' };
const receipt = {
  transactionId: 91,
  amount: '1000',
  fromWalletBalance: '999000',
  status: 'SUCCESS' as const,
  createdAt: '2026-10-21T14:30:00.123456',
};
const controllers: SessionController[] = [];
const cleanup: Array<() => void> = [];

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
  const markers = createTransferMarkerStore(() => storage);
  cleanup.push(bindTransferMarkerCleanup(fixture.controller, markers));
  type Api = ReturnType<typeof createTransferApi>;
  const api = {
    submit: vi.fn<Api['submit']>(async () => receipt),
    getRequest: vi.fn<Api['getRequest']>(async (): Promise<TransferLookup> => ({
      idempotencyKey: key,
      state: 'PENDING',
      request: payload,
      result: null,
      error: null,
      legacyFractional: false,
    })),
  };
  const refreshWallet = vi.fn(async () => undefined);
  const newKey = vi.fn<() => string>(() => key);
  const operation = createTransferSubmission({
    session: fixture.controller,
    access,
    api,
    markers,
    refreshWallet,
    newKey,
  });
  cleanup.push(operation.stop);
  operation.start();
  return { ...fixture, access, storage, markers, api, refreshWallet, newKey, operation };
}

afterEach(async () => {
  cleanup
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('confirmed transfer submission', () => {
  it('reviews a stored PENDING payload before resuming with exactly the same key and details', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    await fixture.operation.checkStatus();
    expect(fixture.api.submit).not.toHaveBeenCalled();
    fixture.operation.reviewResume();
    expect(fixture.operation.getSnapshot()).toMatchObject({
      status: 'resume-review',
      key,
      payload,
    });
    fixture.operation.cancelResume();
    expect(fixture.api.submit).not.toHaveBeenCalled();
    fixture.operation.reviewResume();
    await fixture.operation.resume();
    expect(fixture.api.submit).toHaveBeenCalledWith(payload, key, expect.any(AbortSignal));
    expect(fixture.newKey).not.toHaveBeenCalled();
    expect(fixture.operation.getSnapshot().status).toBe('success');
  });

  it('permits explicit 404 recovery only while the exact original payload remains in memory', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(new ApiError('timeout'));
    await fixture.operation.submit(payload);
    fixture.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', { status: 404, code: 'TRANSFER_REQUEST_NOT_FOUND' }),
    );
    await fixture.operation.checkStatus();
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    fixture.operation.reviewResume();
    expect(fixture.operation.getSnapshot().status).toBe('resume-review');
    await fixture.operation.resume();
    expect(fixture.api.submit).toHaveBeenNthCalledWith(2, payload, key, expect.any(AbortSignal));
    expect(fixture.newKey).toHaveBeenCalledTimes(1);

    const reloaded = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    reloaded.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', { status: 404, code: 'TRANSFER_REQUEST_NOT_FOUND' }),
    );
    await reloaded.operation.checkStatus();
    reloaded.operation.reviewResume();
    await reloaded.operation.resume();
    reloaded.operation.newTransfer();
    expect(reloaded.operation.getSnapshot()).toMatchObject({ status: 'unknown', key });
    expect(reloaded.operation.getSnapshot()).not.toHaveProperty('recovery', expect.anything());
    expect(reloaded.api.submit).not.toHaveBeenCalled();
    expect(reloaded.markers.read()?.idempotencyKey).toBe(key);
  });

  it.each(['1000.50', '50000001', '9999999999999999'])(
    'keeps a stored amount %s read-only instead of changing it to fit a new POST',
    async (amount) => {
      const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
      fixture.api.getRequest.mockResolvedValueOnce({
        idempotencyKey: key,
        state: 'PENDING',
        request: { ...payload, amount },
        result: null,
        error: null,
        legacyFractional: amount.includes('.'),
      });
      await fixture.operation.checkStatus();
      fixture.operation.reviewResume();
      await fixture.operation.resume();
      expect(fixture.operation.getSnapshot().status).toBe('unknown');
      expect(fixture.operation.getSnapshot()).toMatchObject({ readOnlyDetails: { amount } });
      expect(fixture.api.submit).not.toHaveBeenCalled();
      expect(fixture.markers.read()?.idempotencyKey).toBe(key);
    },
  );

  it('normalizes an old whole-valued decimal without changing description, email case or value', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    fixture.api.getRequest.mockResolvedValueOnce({
      idempotencyKey: key,
      state: 'PENDING',
      request: { ...payload, amount: '1000.00', description: '' },
      result: null,
      error: null,
      legacyFractional: false,
    });
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    await fixture.operation.resume();
    expect(fixture.api.submit).toHaveBeenCalledWith(
      { ...payload, description: '' },
      key,
      expect.any(AbortSignal),
    );
  });

  it.each(['IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_KEY_INVALID', 'LEGACY_FRACTIONAL_MONEY'])(
    'does not offer another POST after %s even when lookup is PENDING',
    async (code) => {
      const fixture = await setup();
      fixture.api.submit.mockRejectedValueOnce(new ApiError('business', { status: 409, code }));
      await fixture.operation.submit(payload);
      await fixture.operation.checkStatus();
      fixture.operation.reviewResume();
      await fixture.operation.resume();
      fixture.operation.newTransfer();
      expect(fixture.api.submit).toHaveBeenCalledTimes(1);
      expect(fixture.operation.getSnapshot().status).toBe('unknown');
      expect(fixture.newKey).toHaveBeenCalledTimes(1);
    },
  );

  it('blocks resuming if lookup does not match the payload originally confirmed in this tab', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(new ApiError('network'));
    await fixture.operation.submit(payload);
    fixture.api.getRequest.mockResolvedValueOnce({
      idempotencyKey: key,
      state: 'PENDING',
      request: { ...payload, description: '' },
      result: null,
      error: null,
      legacyFractional: false,
    });
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    await fixture.operation.resume();
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
  });

  it('requires a successful wallet recheck after a conflict before enabling resume review', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(
      new ApiError('business', { status: 409, code: 'CONCURRENT_MODIFICATION' }),
    );
    await fixture.operation.submit(payload);
    fixture.refreshWallet.mockRejectedValueOnce(new ApiError('network'));
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    expect(fixture.operation.getSnapshot().status).toBe('resume-review');
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
  });

  it('checks the marker again and cannot send after it has disappeared during resume review', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    fixture.markers.clearAll();
    await fixture.operation.resume();
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    expect(fixture.api.submit).not.toHaveBeenCalled();
  });

  it('does not enable 404 recovery when the wallet recheck fails', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(new ApiError('network'));
    await fixture.operation.submit(payload);
    fixture.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', { status: 404, code: 'TRANSFER_REQUEST_NOT_FOUND' }),
    );
    fixture.refreshWallet.mockRejectedValueOnce(new ApiError('network'));
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    await fixture.operation.resume();
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.markers.read()?.idempotencyKey).toBe(key);
  });

  it('prevents double resume and does not expose edit or a new key after another timeout', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    let fail: (reason: ApiError) => void = () => undefined;
    fixture.api.submit.mockImplementationOnce(
      () =>
        new Promise<typeof receipt>((_, reject) => {
          fail = reject;
        }),
    );
    const submitted = fixture.operation.resume();
    await fixture.operation.resume();
    fixture.operation.newTransfer();
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    fail(new ApiError('timeout'));
    await submitted;
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    expect(fixture.newKey).not.toHaveBeenCalled();
    expect(fixture.markers.read()?.idempotencyKey).toBe(key);
  });

  it.each(['VALIDATION_ERROR', 'AMOUNT_OUT_OF_RANGE'])(
    'allows editing after fresh pre-registration %s but not after a resume with that error',
    async (code) => {
      const fresh = await setup();
      fresh.api.submit.mockRejectedValueOnce(new ApiError('business', { status: 400, code }));
      await fresh.operation.submit(payload);
      expect(fresh.operation.getSnapshot().status).toBe('rejected');
      fresh.operation.newTransfer();
      expect(fresh.operation.getSnapshot()).toMatchObject({ status: 'idle', draft: payload });

      const recovery = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
      await recovery.operation.checkStatus();
      recovery.operation.reviewResume();
      recovery.api.submit.mockRejectedValueOnce(new ApiError('business', { status: 400, code }));
      await recovery.operation.resume();
      recovery.operation.newTransfer();
      expect(recovery.operation.getSnapshot().status).toBe('unknown');
      expect(recovery.markers.read()?.idempotencyKey).toBe(key);
    },
  );

  it('allows editing a declined transfer but creates a different key only on the next confirmation', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(
      new ApiError('business', { status: 400, code: 'WALLET_INSUFFICIENT_BALANCE' }),
    );
    await fixture.operation.submit(payload);
    fixture.operation.newTransfer();
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'idle', draft: payload });
    expect(fixture.newKey).toHaveBeenCalledTimes(1);
    const nextKey = '550e8400-e29b-41d4-a716-446655440001';
    fixture.newKey.mockReturnValueOnce(nextKey);
    await fixture.operation.submit({ ...payload, description: null });
    expect(fixture.api.submit).toHaveBeenNthCalledWith(
      2,
      { ...payload, description: null },
      nextKey,
      expect.any(AbortSignal),
    );
  });

  it('preserves a successful receipt if storage prevents safely starting another transfer', async () => {
    const fixture = await setup();
    fixture.storage.removeItem.mockImplementation(() => {
      throw new Error('Unavailable');
    });
    await fixture.operation.submit(payload);
    fixture.operation.newTransfer();
    expect(fixture.operation.getSnapshot()).toMatchObject({
      status: 'success',
      receipt,
      restartError: expect.any(String),
    });
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.markers.read()?.idempotencyKey).toBe(key);
  });

  it('requires a lookup after an expired-token POST and never resends on its own', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(
      new ApiError('business', { status: 401, code: 'TOKEN_EXPIRED' }),
    );
    await fixture.operation.submit(payload);
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'unknown', key });
    expect(fixture.api.getRequest).not.toHaveBeenCalled();
    await fixture.operation.checkStatus();
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.newKey).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SELF_TRANSFER_NOT_ALLOWED', 400],
    ['RECIPIENT_NOT_FOUND', 404],
    ['RECIPIENT_LOCKED', 400],
    ['WALLET_NOT_FOUND', 404],
    ['WALLET_INSUFFICIENT_BALANCE', 400],
  ] as const)(
    'allows a fresh reviewed intent only after confirmed %s rejection',
    async (code, status) => {
      const fixture = await setup();
      fixture.api.submit.mockRejectedValueOnce(new ApiError('business', { status, code }));
      await fixture.operation.submit(payload);
      expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'rejected' });
      fixture.operation.newTransfer();
      expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'idle', draft: payload });
      expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps payload recovered by GET in memory for a subsequent 404 without automatically resuming', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    await fixture.operation.checkStatus();
    fixture.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', { status: 404, code: 'TRANSFER_REQUEST_NOT_FOUND' }),
    );
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'resume-review', payload });
    expect(fixture.api.submit).not.toHaveBeenCalled();
  });

  it('removes recovered details on logout during resume review and refuses confirmation', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    await fixture.operation.checkStatus();
    fixture.operation.reviewResume();
    const otherTab = fixture.hub.connect();
    await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    await fixture.operation.resume();
    fixture.operation.newTransfer();
    expect(fixture.operation.getSnapshot().status).toBe('blocked');
    expect(JSON.stringify(fixture.operation.getSnapshot())).not.toContain(payload.toEmail);
    expect(fixture.markers.read()).toBeNull();
    expect(fixture.api.submit).not.toHaveBeenCalled();
  });

  it('ignores a late lookup receipt after cross-tab logout and does not refresh the new scope', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    let release: (value: TransferLookup) => void = () => undefined;
    fixture.api.getRequest.mockImplementationOnce(
      () =>
        new Promise<TransferLookup>((resolve) => {
          release = resolve;
        }),
    );
    const checking = fixture.operation.checkStatus();
    const otherTab = fixture.hub.connect();
    await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    release({
      idempotencyKey: key,
      state: 'SUCCEEDED',
      request: payload,
      result: receipt,
      error: null,
      legacyFractional: false,
    });
    await checking;
    expect(fixture.operation.getSnapshot().status).toBe('blocked');
    expect(fixture.refreshWallet).not.toHaveBeenCalled();
    expect(fixture.markers.read()).toBeNull();
  });

  it('persists only user/key before dispatch and ignores duplicate confirmations', async () => {
    const fixture = await setup();
    let release: (value: typeof receipt) => void = () => undefined;
    fixture.api.submit.mockImplementationOnce(async () => {
      expect(fixture.markers.read()).toEqual({ userId: 1, idempotencyKey: key });
      return new Promise<typeof receipt>((resolve) => {
        release = resolve;
      });
    });
    const submitted = fixture.operation.submit(payload);
    expect(fixture.operation.getSnapshot().status).toBe('submitting');
    await fixture.operation.submit(payload);
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.newKey).toHaveBeenCalledTimes(1);
    expect(fixture.storage.setItem).toHaveBeenCalledWith(
      TRANSFER_MARKER_KEY,
      JSON.stringify({ userId: 1, idempotencyKey: key }),
    );
    release(receipt);
    await submitted;
    expect(fixture.operation.getSnapshot()).toMatchObject({
      status: 'success',
      receipt,
      walletRefresh: 'ready',
    });
    expect(fixture.markers.read()).toBeNull();
    expect(fixture.refreshWallet).toHaveBeenCalledOnce();
    await fixture.operation.submit(payload);
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
  });

  it('does not send when recovery storage cannot be written', async () => {
    const fixture = await setup();
    fixture.storage.setItem.mockImplementation(() => {
      throw new Error('Quota');
    });
    await fixture.operation.submit(payload);
    expect(fixture.api.submit).not.toHaveBeenCalled();
    expect(fixture.operation.getSnapshot().status).toBe('blocked');
  });

  it('keeps a successful receipt when refreshing the wallet fails', async () => {
    const fixture = await setup();
    fixture.refreshWallet.mockRejectedValueOnce(new Error('Read failed'));
    await fixture.operation.submit(payload);
    expect(fixture.operation.getSnapshot()).toMatchObject({
      status: 'success',
      receipt,
      walletRefresh: 'error',
    });
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    new ApiError('timeout'),
    new ApiError('network'),
    new ApiError('protocol'),
    new ApiError('cancelled'),
    new ApiError('business', { status: 500, code: 'INTERNAL_SERVER_ERROR' }),
    new ApiError('business', { status: 409, code: 'TRANSFER_IN_PROGRESS' }),
    new ApiError('business', { status: 409, code: 'CONCURRENT_MODIFICATION' }),
    new ApiError('business', { status: 401, code: 'TOKEN_EXPIRED' }),
  ])('retains an uncertain intent without retry, automatic GET or a new key', async (error) => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(error);
    await fixture.operation.submit(payload);
    await fixture.operation.submit({ ...payload, amount: '2000' });
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'unknown', key });
    expect(fixture.markers.read()).toEqual({ userId: 1, idempotencyKey: key });
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.api.getRequest).not.toHaveBeenCalled();
    expect(fixture.newKey).toHaveBeenCalledTimes(1);
  });

  it('records only a whitelisted stored business rejection as declined', async () => {
    const fixture = await setup();
    fixture.api.submit.mockRejectedValueOnce(
      new ApiError('business', { status: 400, code: 'WALLET_INSUFFICIENT_BALANCE' }),
    );
    await fixture.operation.submit(payload);
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'rejected' });
    expect(fixture.markers.read()).toBeNull();
    expect(fixture.refreshWallet).not.toHaveBeenCalled();
  });

  it('restores a marker read-only and never submits on PENDING or 404', async () => {
    const fixture = await setup(JSON.stringify({ userId: 1, idempotencyKey: key }));
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    expect(fixture.api.getRequest).not.toHaveBeenCalled();
    await fixture.operation.submit(payload);
    await fixture.operation.checkStatus();
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    fixture.api.getRequest.mockRejectedValueOnce(
      new ApiError('business', { status: 404, code: 'TRANSFER_REQUEST_NOT_FOUND' }),
    );
    await fixture.operation.checkStatus();
    expect(fixture.operation.getSnapshot().status).toBe('unknown');
    expect(fixture.markers.read()).not.toBeNull();
    fixture.api.getRequest.mockResolvedValueOnce({
      idempotencyKey: key,
      state: 'SUCCEEDED',
      request: payload,
      result: receipt,
      error: null,
      legacyFractional: false,
    });
    await fixture.operation.checkStatus();
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'success', receipt });
    expect(fixture.api.submit).not.toHaveBeenCalled();
    expect(fixture.newKey).not.toHaveBeenCalled();
  });

  it('ignores a late receipt after cross-tab logout and cleans the marker', async () => {
    const fixture = await setup();
    let release: (value: typeof receipt) => void = () => undefined;
    fixture.api.submit.mockImplementationOnce(
      async () =>
        new Promise<typeof receipt>((resolve) => {
          release = resolve;
        }),
    );
    const submitted = fixture.operation.submit(payload);
    const otherTab = fixture.hub.connect();
    await otherTab.change(() => ({ version: 1, epoch: otherTab.newEpoch(), mode: 'signed-out' }));
    release(receipt);
    await submitted;
    expect(fixture.operation.getSnapshot().status).toBe('blocked');
    expect(fixture.refreshWallet).not.toHaveBeenCalled();
    expect(fixture.markers.read()).toBeNull();
  });

  it('preserves an interrupted intent across stop/start without resubmitting', async () => {
    const fixture = await setup();
    let release: (value: typeof receipt) => void = () => undefined;
    fixture.api.submit.mockImplementationOnce(
      async () =>
        new Promise<typeof receipt>((resolve) => {
          release = resolve;
        }),
    );
    const submitted = fixture.operation.submit(payload);
    fixture.operation.stop();
    fixture.operation.start();
    release(receipt);
    await submitted;
    expect(fixture.operation.getSnapshot()).toMatchObject({ status: 'unknown', key });
    expect(fixture.api.submit).toHaveBeenCalledTimes(1);
    expect(fixture.refreshWallet).not.toHaveBeenCalled();
    expect(fixture.markers.read()).not.toBeNull();
  });
});
