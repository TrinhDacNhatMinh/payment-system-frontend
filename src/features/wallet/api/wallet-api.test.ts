import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { errorReply, successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { createWalletApi } from './wallet-api';
import { walletResponseSchema } from './wallet-schemas';

const controllers: SessionController[] = [];
const wallet = {
  id: 2,
  userId: testSession.user.id,
  balance: 0,
  currency: 'VND',
  updatedAt: '2026-10-21T14:30:00.123456',
};

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('wallet adapter', () => {
  it('reads the singular wallet endpoint with a verified bearer and accepts zero', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply(wallet),
    ]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const api = createWalletApi(fixture.privateApi, access);
    await expect(api.getMyWallet()).resolves.toEqual(wallet);
    const config = fixture.adapter.mock.calls[2]?.[0];
    expect(config?.url).toBe('/api/v1/wallet/me');
    expect(config?.headers.get('Authorization')).toBe('Bearer test-access');
    expect(config?.withCredentials).toBe(false);
    expect(config?.headers.get('Idempotency-Key')).toBeUndefined();
  });

  it('rejects another user wallet and does not turn missing wallets into zero balances', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ ...wallet, userId: 99 }),
      errorReply('WALLET_NOT_FOUND', 404),
    ]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const api = createWalletApi(fixture.privateApi, access);
    await expect(api.getMyWallet()).rejects.toMatchObject({ kind: 'protocol' });
    await expect(api.getMyWallet()).rejects.toMatchObject({
      code: 'WALLET_NOT_FOUND',
      status: 404,
    });
  });

  it('keeps legacy numeric balances separate from exact transfer strings', () => {
    expect(walletResponseSchema.parse({ ...wallet, balance: 1000.5 }).balance).toBe(1000.5);
    for (const balance of ['1000.50', -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(walletResponseSchema.safeParse({ ...wallet, balance }).success).toBe(false);
    }
    expect(walletResponseSchema.safeParse({ ...wallet, currency: 'USD' }).success).toBe(false);
  });
});
