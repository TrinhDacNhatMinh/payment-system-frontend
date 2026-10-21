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
  const newKey = vi.fn(() => key);
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
