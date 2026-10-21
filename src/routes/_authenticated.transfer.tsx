import { createFileRoute } from '@tanstack/react-router';

import { TransferPage } from '@/features/transfer/pages/transfer-page';

// The shared private parent restores and verifies the session before rendering.
export const Route = createFileRoute('/_authenticated/transfer')({ component: TransferPage });
