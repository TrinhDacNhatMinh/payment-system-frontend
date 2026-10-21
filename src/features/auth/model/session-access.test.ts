import { afterEach, describe, expect, it } from 'vitest';

import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { requireSessionAccess } from './session-access';
import type { SessionController } from './session-controller';

const controllers: SessionController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((session) => session.stop()));
});

describe('private session access', () => {
  it('waits for bootstrap before allowing access', async () => {
    const { controller, adapter } = createSessionFixture([csrfReply(), successReply(testSession)]);
    controllers.push(controller);
    const access = requireSessionAccess(controller);
    expect(adapter).not.toHaveBeenCalled();
    controller.start();
    await expect(access).resolves.toMatchObject({ user: testSession.user });
    expect(adapter).toHaveBeenCalledTimes(2);
  });

  it('denies speculative preload without bootstrapping a session', async () => {
    const { controller, adapter } = createSessionFixture([]);
    await expect(requireSessionAccess(controller, { preload: true })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it.each(['USER', 'ADMIN'] as const)(
    'checks required ADMIN role against verified %s identity',
    async (role) => {
      const { controller } = createSessionFixture([
        csrfReply(),
        successReply({ ...testSession, user: { ...testSession.user, role } }),
      ]);
      controllers.push(controller);
      controller.start();
      await controller.restore();
      const access = requireSessionAccess(controller, { roles: ['ADMIN'] });
      if (role === 'ADMIN') await expect(access).resolves.toMatchObject({ user: { role } });
      else {
        await expect(access).rejects.toMatchObject({ denied: true, code: 'ACCESS_DENIED' });
        expect(controller.getSnapshot().status).toBe('authenticated');
      }
    },
  );

  it('cancels a navigation waiting for restoration without starting auth requests', async () => {
    const { controller, adapter } = createSessionFixture([]);
    const abort = new AbortController();
    const access = requireSessionAccess(controller, { signal: abort.signal });
    abort.abort();
    await expect(access).rejects.toMatchObject({ kind: 'cancelled' });
    expect(adapter).not.toHaveBeenCalled();
  });
});
