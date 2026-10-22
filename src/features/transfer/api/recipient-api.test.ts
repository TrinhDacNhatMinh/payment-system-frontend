import { afterEach, describe, expect, it } from 'vitest';

import { requireSessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { successReply } from '@/test/api-adapter';
import { createSessionFixture, csrfReply, testSession } from '@/test/auth-session';
import { createRecipientApi, RECIPIENT_LOOKUP_PATH } from './recipient-api';

const controllers: SessionController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.stop()));
});

describe('recipient existence API', () => {
  it('trims email, preserves case and sends a private read without a transfer', async () => {
    const fixture = createSessionFixture([
      csrfReply(),
      successReply(testSession),
      successReply({ exists: false }),
      successReply({ exists: 'true' }),
    ]);
    controllers.push(fixture.controller);
    fixture.controller.start();
    const access = await requireSessionAccess(fixture.controller);
    const check = createRecipientApi(fixture.privateApi, access);
    await expect(check(' Recipient@example.com ', new AbortController().signal)).resolves.toBe(
      false,
    );
    const config = fixture.adapter.mock.calls[2]?.[0];
    expect(config?.url).toBe(RECIPIENT_LOOKUP_PATH);
    expect(config?.method).toBe('get');
    expect(config?.params).toEqual({ email: 'Recipient@example.com' });
    expect(config?.headers.get('Authorization')).toBe('Bearer test-access');
    expect(config?.withCredentials).toBe(false);
    await expect(check('bad', new AbortController().signal)).rejects.toMatchObject({
      kind: 'client',
    });
    expect(fixture.adapter).toHaveBeenCalledTimes(3);
    await expect(check('other@example.com', new AbortController().signal)).rejects.toMatchObject({
      kind: 'protocol',
    });
  });
});
