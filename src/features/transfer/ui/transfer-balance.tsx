import { useQuery } from '@tanstack/react-query';

import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { walletQueryOptions } from '@/features/wallet/api/wallet-query';
import { formatWalletBalance } from '@/features/wallet/model/wallet-display';
import { normalizeApiError } from '@/shared/api/api-error';
import type { ApiTransport } from '@/shared/api/http-client';

export function TransferBalance(props: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
}) {
  const query = useQuery(walletQueryOptions(props));
  const error = query.error ? normalizeApiError(query.error) : null;
  const unavailable =
    error?.status === 401 || error?.status === 403 || error?.code === 'WALLET_NOT_FOUND';
  let balance: string | undefined;
  if (query.data && !unavailable) {
    try {
      balance = formatWalletBalance(query.data.balance);
    } catch {
      // A legacy fraction or unsafe number must never be rounded for display.
      balance = undefined;
    }
  }

  return (
    <section className="transfer-balance" aria-label="Wallet balance" aria-busy={query.isFetching}>
      <p>{error && balance !== undefined ? 'Last known balance' : 'Available balance'}</p>
      {balance !== undefined ? (
        <output aria-label={`Available balance: ${balance} VND`} aria-live="off">
          {balance} <span>VND</span>
        </output>
      ) : (
        <p className="transfer-balance-feedback" role="status">
          {query.isPending ? 'Loading balance…' : 'Balance unavailable'}
        </p>
      )}
    </section>
  );
}
