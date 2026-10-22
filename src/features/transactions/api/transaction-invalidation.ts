import type { QueryClient } from '@tanstack/react-query';

import { sameAccess, type SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { MY_TRANSACTIONS_PATH } from './transaction-api';

export async function invalidateTransactionHistory(options: {
  client: QueryClient;
  session: SessionController;
  access: SessionAccess;
}) {
  const { client, session, access } = options;
  const current = () => sameAccess(session.getAccessIdentity(), access);
  const queryKey = [
    'private',
    access.epoch,
    access.user.id,
    access.user.role,
    MY_TRANSACTIONS_PATH,
  ];
  if (!current()) return;
  // Discard any snapshot requested before the confirmed money operation.
  await client.cancelQueries({ queryKey });
  if (!current()) return;
  await client.invalidateQueries({ queryKey, refetchType: 'none' });
  if (!current()) return;
  // A read failure belongs to the history query; never undo a payment receipt.
  void client.refetchQueries({ queryKey, type: 'active' }).catch(() => undefined);
}
