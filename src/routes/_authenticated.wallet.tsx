import { createFileRoute } from '@tanstack/react-router';

import { WalletPage } from '@/features/wallet/pages/wallet-page';

// The parent verifies the session before this page or any child loader runs.
export const Route = createFileRoute('/_authenticated/wallet')({ component: WalletPage });
