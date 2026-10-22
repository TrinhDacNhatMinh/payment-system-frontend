import { QueryClient } from '@tanstack/react-query';
import type { AxiosAdapter } from 'axios';
import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { createApiAdapter, successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { MY_TRANSACTIONS_PATH } from './transaction-api';
import { transactionPage } from './transaction-fixture.test-support';
import { transactionQueryOptions } from './transaction-query';

const controllers: SessionController[] = [];
const clients: QueryClient[] = [];

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  for (const client of clients.splice(0)) client.clear();
});

describe('transaction query isolation', () => {
  it('keys normalized selectors and session identity, refetches on focus without polling', async () => {
    const fixture = createSessionFixture([csrfReply(), successReply(testSession)]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const base = {
      session: fixture.controller,
      access,
      api: fixture.privateApi(access),
    };
    const first = transactionQueryOptions(base);
    expect(transactionQueryOptions({ ...base, filters: { page: 0, size: 10 } }).queryKey).toEqual(
      first.queryKey,
    );
    for (const filters of [
      { page: 1 },
      { size: 20 },
      { type: 'DEPOSIT' as const },
      { status: 'FAILED' as const },
      { fromDate: '2026-10-22T00:00:00' },
      { toDate: '2026-10-22T23:59:59.999999' },
    ]) {
      expect(transactionQueryOptions({ ...base, filters }).queryKey).not.toEqual(first.queryKey);
    }
    expect(first.queryKey.slice(0, 4)).toEqual([
      'private',
      access.epoch,
      access.user.id,
      access.user.role,
    ]);
    expect(first.retry).toBe(false);
    expect(first.refetchInterval).toBe(false);
    expect(first.refetchOnWindowFocus).toBe(true);
    expect(first.refetchOnReconnect).toBe(true);
    expect(first.gcTime).toBe(0);
    expect(first).not.toHaveProperty('placeholderData');
  });

  it('clears cached history on account change and blocks an old query through fetchQuery', async () => {
    const client = new QueryClient();
    clients.push(client);
    const fixture = createSessionFixture(
      [
        csrfReply(),
        successReply(testSession),
        successReply(transactionPage),
        csrfReply(),
        successReply({
          ...testSession,
          user: { ...testSession.user, id: 2, email: 'other@example.com' },
        }),
        successReply({ ...transactionPage, content: [], totalElements: 0, totalPages: 0 }),
      ],
      { clearPrivateData: () => client.clear() },
    );
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const first = transactionQueryOptions({
      session: fixture.controller,
      access,
      api: fixture.privateApi(access),
    });
    await expect(client.fetchQuery(first)).resolves.toEqual(transactionPage);
    await fixture.controller.login(
      { email: 'other@example.com', password: 'secret' },
      new AbortController().signal,
    );
    expect(client.getQueryData(first.queryKey)).toBeUndefined();
    await expect(client.fetchQuery(first)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const nextAccess = await requireSessionAccess(fixture.controller);
    const next = transactionQueryOptions({
      session: fixture.controller,
      access: nextAccess,
      api: fixture.privateApi(nextAccess),
    });
    expect(next.queryKey).not.toEqual(first.queryKey);
    await expect(client.fetchQuery(next)).resolves.toMatchObject({ content: [] });
    expect(fixture.adapter).toHaveBeenCalledTimes(6);
  });

  it('does not cache a response with unsupported money', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({
        ...transactionPage,
        content: transactionPage.content.map((row) => ({ ...row, amount: 1000.5 })),
      }),
    ]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const client = new QueryClient();
    clients.push(client);
    const options = transactionQueryOptions({
      session: fixture.controller,
      access,
      api: fixture.privateApi(access),
    });
    await expect(client.fetchQuery(options)).rejects.toMatchObject({ kind: 'protocol' });
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
  });

  it('discards a delayed old-account response after a new login', async () => {
    let release: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = createApiAdapter([
      csrfReply(),
      successReply(testSession),
      csrfReply(),
      successReply({ ...testSession, user: { ...testSession.user, id: 2 } }),
      successReply(transactionPage),
    ]);
    const delayed: AxiosAdapter = async (config) => {
      if (config.url === MY_TRANSACTIONS_PATH) {
        markStarted();
        await pending;
      }
      return adapter(config);
    };
    const fixture = createSessionFixture([], { adapter: delayed });
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const client = new QueryClient();
    clients.push(client);
    const options = transactionQueryOptions({
      session: fixture.controller,
      access,
      api: fixture.privateApi(access),
    });
    const result = client.fetchQuery(options);
    const rejected = expect(result).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    try {
      await started;
      await fixture.controller.login(
        { email: 'other@example.com', password: 'secret' },
        new AbortController().signal,
      );
    } finally {
      release();
    }
    await rejected;
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
  });
});
