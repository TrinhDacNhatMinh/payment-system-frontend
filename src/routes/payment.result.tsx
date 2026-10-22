import { createFileRoute } from '@tanstack/react-router';

import { PaymentResultPage } from '@/features/deposit/pages/payment-result-page';
import { parsePaymentResultSearch } from '@/shared/lib/payment-result-context';

export const Route = createFileRoute('/payment/result')({
  validateSearch: parsePaymentResultSearch,
  component: PaymentResultPage,
});
