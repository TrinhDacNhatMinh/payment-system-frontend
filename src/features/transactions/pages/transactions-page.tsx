import { useQuery } from '@tanstack/react-query';

import { useAuthSession } from '@/features/auth/model/session-context';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { normalizeApiError } from '@/shared/api/api-error';
import type { ApiTransport } from '@/shared/api/http-client';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { transactionQueryOptions } from '../api/transaction-query';
import { TransactionHistory } from '../ui/transaction-history';

export function TransactionsPage() {
  const session = useAuthSession();
  const access = session?.controller.getAccessIdentity();
  if (!session?.privateApi || !access) {
    return <ContentState kind="loading" title="Checking your session…" />;
  }
  return (
    <TransactionsContent
      key={`${access.epoch}:${access.user.id}:${access.user.role}`}
      session={session.controller}
      access={access}
      api={session.privateApi(access)}
    />
  );
}

function TransactionsContent({
  session,
  access,
  api,
}: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
}) {
  const query = useQuery(transactionQueryOptions({ session, access, api }));
  const error = query.error ? normalizeApiError(query.error) : null;
  const unavailable = error?.code === 'WALLET_NOT_FOUND';
  const accessRejected = error?.status === 401 || error?.status === 403;
  const retry = () => {
    if (!query.isFetching) void query.refetch({ cancelRefetch: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Transactions" />
      {query.isError ? (
        <ContentState
          kind={unavailable ? 'warning' : 'error'}
          title={unavailable ? 'Wallet not found' : 'Unable to load transactions'}
          description={
            unavailable
              ? 'No wallet was found for your account.'
              : error?.kind === 'protocol'
                ? 'Your transaction history could not be displayed reliably. Please try again later.'
                : (error?.message ?? 'Your transaction history is unavailable. Please try again.')
          }
          onRetry={accessRejected ? undefined : retry}
        />
      ) : query.isPending ? (
        query.isPaused ? (
          <ContentState
            kind="warning"
            title="You’re offline"
            description="Reconnect to load your transactions."
          />
        ) : (
          <ContentState kind="loading" title="Loading transactions…" />
        )
      ) : (
        <section aria-label="Transaction history" aria-busy={query.isFetching}>
          {query.isFetching && <p role="status">Updating transactions…</p>}
          {query.data.content.length === 0 ? (
            <ContentState
              kind="empty"
              title={
                query.data.totalElements === 0
                  ? 'No transactions yet'
                  : 'No transactions on this page'
              }
              description={
                query.data.totalElements === 0
                  ? 'Your transfers and top-ups will appear here.'
                  : 'There are no transactions to display on this page.'
              }
            />
          ) : (
            <div>
              <p>
                {query.data.totalElements.toLocaleString('en-US')}{' '}
                {query.data.totalElements === 1 ? 'transaction' : 'transactions'}
              </p>
              <TransactionHistory transactions={query.data.content} />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
