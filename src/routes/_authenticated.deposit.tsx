import { createFileRoute } from '@tanstack/react-router';

import { DepositPage } from '@/features/deposit/pages/deposit-page';

export const Route = createFileRoute('/_authenticated/deposit')({ component: DepositPage });
