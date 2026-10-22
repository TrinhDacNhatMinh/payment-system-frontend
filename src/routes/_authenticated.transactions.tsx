import { createFileRoute } from '@tanstack/react-router';

import { TransactionsPage } from '@/features/transactions/pages/transactions-page';

// The private parent verifies the session before this page starts its query.
export const Route = createFileRoute('/_authenticated/transactions')({
  component: TransactionsPage,
});
