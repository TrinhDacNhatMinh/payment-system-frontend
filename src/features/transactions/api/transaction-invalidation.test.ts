import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { MY_TRANSACTIONS_PATH } from './transaction-api';
import { transactionPage } from './transaction-fixture.test-support';
import { invalidateTransactionHistory } from './transaction-invalidation';

const clients: QueryClient[] = [];
const controllers: SessionController[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  clients.splice(0).forEach((client) => client.clear());
});

describe('history invalidation after confirmed payments', () => {
  it('invalidates all matching pages and filters while preserving other scopes and endpoints', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const client = new QueryClient();
    clients.push(client);
    const prefix = ['private', access.epoch, access.user.id, access.user.role];
    const matching = [
      [...prefix, MY_TRANSACTIONS_PATH, { page: 0, size: 10 }, 'transactions'],
      [...prefix, MY_TRANSACTIONS_PATH, { page: 3, size: 20, type: 'DEPOSIT' }, 'transactions'],
    ];
    const other = [
      ['private', 'old-epoch', access.user.id, access.user.role, MY_TRANSACTIONS_PATH],
      ['private', access.epoch, 99, access.user.role, MY_TRANSACTIONS_PATH],
      ['private', access.epoch, access.user.id, 'ADMIN', MY_TRANSACTIONS_PATH],
      [...prefix, '/api/v1/wallet/me'],
    ];
    for (const key of [...matching, ...other]) client.setQueryData(key, transactionPage);
    await invalidateTransactionHistory({ client, session: fixture.controller, access });
    for (const key of matching) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryData(key)).toEqual(transactionPage);
    }
    for (const key of other) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(fixture.adapter).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate after the originating account has changed or create history queries', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      csrfReply(),
      successReply({ ...testSession, user: { ...testSession.user, id: 2 } }),
    ]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const client = new QueryClient();
    clients.push(client);
    await invalidateTransactionHistory({ client, session: fixture.controller, access });
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    const key = ['private', access.epoch, access.user.id, access.user.role, MY_TRANSACTIONS_PATH];
    client.setQueryData(key, transactionPage);
    await fixture.controller.login(
      { email: 'other@example.com', password: 'secret' },
      new AbortController().signal,
    );
    await invalidateTransactionHistory({ client, session: fixture.controller, access });
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    expect(fixture.adapter).toHaveBeenCalledTimes(4);
  });
});
