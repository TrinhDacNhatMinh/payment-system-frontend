import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorReply, successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { requireSessionAccess } from '../model/session-access';
import type { SessionController } from '../model/session-controller';
import { privateQueryOptions } from './private-query';

const controllers: SessionController[] = [];
const clients: QueryClient[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((session) => session.stop()));
  for (const client of clients.splice(0)) client.clear();
});

describe('private query scope', () => {
  it('clears cached data and blocks the old query scope even when logout fails', async () => {
    const client = new QueryClient();
    clients.push(client);
    const fixture = createSessionFixture(
      [
        csrfReply(),
        successReply(testSession),
        successReply({ value: 1 }),
        csrfReply(),
        errorReply('INTERNAL_SERVER_ERROR', 500),
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
    const access = await requireSessionAccess(fixture.controller);
    const query = privateQueryOptions({
      session: fixture.controller,
      access,
      api: fixture.privateApi(access),
      key: ['wallet'],
      request: { path: '/api/v1/wallets/me' },
      schema: z.object({ value: z.number() }),
    });
    await client.fetchQuery(query);
    const logout = fixture.controller.logout();
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
    await logout;
    expect(fixture.controller.getSnapshot().status).toBe('logout-pending');
    await expect(client.fetchQuery(query)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fixture.adapter).toHaveBeenCalledTimes(5);
  });

  it('partitions the cache by epoch/user/role and denies stale fetchQuery calls', async () => {
    const client = new QueryClient();
    clients.push(client);
    const fixture = createSessionFixture(
      [
        csrfReply(),
        successReply(testSession),
        successReply({ value: 1 }),
        csrfReply(),
        successReply({
          ...testSession,
          user: { ...testSession.user, id: 2, email: 'other@example.com' },
        }),
        successReply({ value: 2 }),
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
    const first = privateQueryOptions({
      session: fixture.controller,
      access: firstAccess,
      api: fixture.privateApi(firstAccess),
      key: ['wallet'],
      request: { path: '/api/v1/wallets/me' },
      schema: z.object({ value: z.number() }),
    });
    await expect(client.fetchQuery(first)).resolves.toEqual({ value: 1 });
    await fixture.controller.login(
      { email: 'other@example.com', password: 'secret' },
      new AbortController().signal,
    );
    expect(client.getQueryData(first.queryKey)).toBeUndefined();
    await expect(client.fetchQuery(first)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const secondAccess = await requireSessionAccess(fixture.controller);
    const second = privateQueryOptions({
      session: fixture.controller,
      access: secondAccess,
      api: fixture.privateApi(secondAccess),
      key: ['wallet'],
      request: { path: '/api/v1/wallets/me' },
      schema: z.object({ value: z.number() }),
    });
    expect(second.queryKey).not.toEqual(first.queryKey);
    await expect(client.fetchQuery(second)).resolves.toEqual({ value: 2 });
    expect(fixture.adapter).toHaveBeenCalledTimes(6);
  });
});
