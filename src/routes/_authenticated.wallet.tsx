import { createFileRoute } from '@tanstack/react-router';

import { WalletPage } from '@/features/wallet/pages/wallet-page';

// This child is deliberately not rendered by the parent during scaffolding.
export const Route = createFileRoute('/_authenticated/wallet')({ component: WalletPage });
