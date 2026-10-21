import { focusManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { walletQueryOptions } from './wallet-query';

const controllers: SessionController[] = [];
const clients: QueryClient[] = [];
const wallet = {
  id: 7,
  userId: testSession.user.id,
  balance: 1000.5,
  currency: 'VND',
  updatedAt: '2026-10-21T14:30:00.123456',
};

afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
  for (const client of clients.splice(0)) client.clear();
});

describe('wallet query scope', () => {
  it('polls visible wallet data every two seconds and stops when hidden or unmounted', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    focusManager.setFocused(true);
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ ...wallet, balance: 1000 }),
      successReply({ ...wallet, balance: 2000 }),
      successReply({ ...wallet, balance: 3000 }),
    ]);
    controllers.push(fixture.controller);
    const client = new QueryClient();
    clients.push(client);
    let unsubscribe: () => void = () => undefined;
    try {
      fixture.controller.start();
      const access = await requireSessionAccess(fixture.controller);
      const options = walletQueryOptions({
        session: fixture.controller,
        access,
        api: fixture.privateApi(access),
      });
      const observer = new QueryObserver(client, options);
      async function expectBalance(expected: number) {
        let stopWaiting: () => void = () => undefined;
        try {
          await new Promise<void>((resolve, reject) => {
            const check = () => {
              const result = observer.getCurrentResult();
              if (result.isError) reject(result.error);
              else if (result.data?.balance === expected) resolve();
            };
            stopWaiting = observer.subscribe(check);
            check();
          });
          expect(observer.getCurrentResult().data?.balance).toBe(expected);
        } finally {
          stopWaiting();
        }
      }
      unsubscribe = observer.subscribe(() => undefined);
      await expectBalance(1000);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fixture.adapter).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      await expectBalance(2000);

      focusManager.setFocused(false);
      await vi.advanceTimersByTimeAsync(6000);
      expect(fixture.adapter).toHaveBeenCalledTimes(4);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(2000);
      await expectBalance(3000);

      unsubscribe();
      await vi.advanceTimersByTimeAsync(6000);
      expect(fixture.adapter).toHaveBeenCalledTimes(5);
    } finally {
      unsubscribe();
      focusManager.setFocused(undefined);
      vi.useRealTimers();
    }
  });

  it('partitions real wallet data and blocks an old query even via fetchQuery', async () => {
    const client = new QueryClient();
    clients.push(client);
    const fixture = createSessionFixture(
      [
        csrfReply(),
        successReply(testSession),
        successReply(wallet),
        csrfReply(),
        successReply({
          ...testSession,
          user: { ...testSession.user, id: 2, email: 'other@example.com' },
        }),
        successReply({ ...wallet, userId: 2, balance: 0 }),
      ],
      {
        clearPrivateData: () => {
          void client.cancelQueries();
          client.clear();
        },
      },
    );
    controllers.push(fixture.controller);
    fixture.controller.start();
    const firstAccess = await requireSessionAccess(fixture.controller);
    const first = walletQueryOptions({
      session: fixture.controller,
      access: firstAccess,
      api: fixture.privateApi(firstAccess),
    });
    await expect(client.fetchQuery(first)).resolves.toEqual(wallet);
    await fixture.controller.login(
      { email: 'other@example.com', password: 'secret' },
      new AbortController().signal,
    );
    expect(client.getQueryData(first.queryKey)).toBeUndefined();
    await expect(client.fetchQuery(first)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const nextAccess = await requireSessionAccess(fixture.controller);
    const next = walletQueryOptions({
      session: fixture.controller,
      access: nextAccess,
      api: fixture.privateApi(nextAccess),
    });
    expect(next.queryKey).not.toEqual(first.queryKey);
    await expect(client.fetchQuery(next)).resolves.toMatchObject({ userId: 2, balance: 0 });
    expect(fixture.adapter).toHaveBeenCalledTimes(6);
  });

  it('rejects data owned by another principal before caching it', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ ...wallet, userId: 99 }),
    ]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const client = new QueryClient();
    clients.push(client);
    const options = walletQueryOptions({
      session: fixture.controller,
      access,
      api: fixture.privateApi(access),
    });
    await expect(client.fetchQuery(options)).rejects.toMatchObject({ kind: 'protocol' });
    expect(client.getQueryData(options.queryKey)).toBeUndefined();
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
  });
});
