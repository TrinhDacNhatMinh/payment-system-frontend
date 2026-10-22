import { useQuery } from '@tanstack/react-query';
import { getRouteApi } from '@tanstack/react-router';
import { Button } from 'antd';

import { useAuthSession } from '@/features/auth/model/session-context';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { normalizeApiError } from '@/shared/api/api-error';
import type { ApiTransport } from '@/shared/api/http-client';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { transactionQueryOptions } from '../api/transaction-query';
import { TransactionHistory } from '../ui/transaction-history';
import { TransactionFilters } from '../ui/transaction-filters';
import { TransactionPagination } from '../ui/transaction-pagination';
import {
  appliedTransactionFilters,
  transactionFilterDraft,
  transactionSearchFromDraft,
  transactionPageSearch,
  type TransactionFilterDraft,
  type TransactionSearch,
} from '../model/transaction-search';

const route = getRouteApi('/_authenticated/transactions');

export function TransactionsPage() {
  const session = useAuthSession();
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const access = session?.controller.getAccessIdentity();
  if (!session?.privateApi || !access) {
    return <ContentState kind="loading" title="Checking your session…" />;
  }
  if (search.invalid) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeading title="Transactions" />
        <ContentState
          kind="warning"
          title="Invalid filters"
          description="Check the filters in the address or reset them to view your transactions."
        />
        <Button onClick={() => void navigate({ search: {}, replace: true })}>Reset filters</Button>
      </div>
    );
  }
  return (
    <TransactionsContent
      key={`${access.epoch}:${access.user.id}:${access.user.role}`}
      session={session.controller}
      access={access}
      api={session.privateApi(access)}
      search={search}
      apply={(draft) => navigate({ search: transactionSearchFromDraft(draft) })}
      changePage={(page, replace = false) =>
        navigate({
          search: transactionPageSearch(search, page),
          replace,
        })
      }
    />
  );
}

function TransactionsContent({
  session,
  access,
  api,
  search,
  apply,
  changePage,
}: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
  search: TransactionSearch;
  apply: (value: TransactionFilterDraft) => Promise<void>;
  changePage: (page: number, replace?: boolean) => Promise<void>;
}) {
  const query = useQuery(
    transactionQueryOptions({
      session,
      access,
      api,
      filters: appliedTransactionFilters(search),
    }),
  );
  const hasFilters = Boolean(search.type || search.status || search.fromDate || search.toDate);
  const error = query.error ? normalizeApiError(query.error) : null;
  const unavailable = error?.code === 'WALLET_NOT_FOUND';
  const accessRejected = error?.status === 401 || error?.status === 403;
  const page = search.page ?? 1;
  const outOfRange = query.isSuccess && page > Math.max(1, query.data.totalPages);
  const retry = () => {
    if (!query.isFetching) void query.refetch({ cancelRefetch: false });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Transactions" />
      <TransactionFilters
        key={JSON.stringify(search)}
        initialValues={transactionFilterDraft(search)}
        apply={apply}
      />
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
          {outOfRange ? (
            <ContentState
              kind="empty"
              title="Page unavailable"
              description="This page no longer has transactions. Return to the first page."
              action={<Button onClick={() => void changePage(1, true)}>Go to first page</Button>}
            />
          ) : query.data.content.length === 0 ? (
            <ContentState
              kind="empty"
              title={
                query.data.totalElements === 0
                  ? hasFilters
                    ? 'No matching transactions'
                    : 'No transactions yet'
                  : 'No transactions on this page'
              }
              description={
                query.data.totalElements === 0
                  ? hasFilters
                    ? 'Try different filters or reset them.'
                    : 'Your transfers and top-ups will appear here.'
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
          {!outOfRange && (
            <TransactionPagination
              page={page}
              total={query.data.totalElements}
              busy={query.isFetching}
              change={changePage}
            />
          )}
        </section>
      )}
    </div>
  );
}
