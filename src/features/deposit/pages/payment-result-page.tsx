import { Link, useLocation } from '@tanstack/react-router';

import { AppLayout } from '@/app/layouts/app-layout';
import { PrivateContent } from '@/app/layouts/private-content';
import { SignedOutPage } from '@/app/layouts/signed-out-page';
import { useAuthSession } from '@/features/auth/model/session-context';
import { parsePaymentResultSearch } from '@/shared/lib/payment-result-context';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';

export function PaymentResultPage() {
  const location = useLocation();
  const search = parsePaymentResultSearch(location.search);
  const session = useAuthSession();
  const access = session?.controller.getAccessIdentity();
  if (!search.orderId) {
    return (
      <AppLayout>
        <div className="wallet-panel">
          <PageHeading title="Top-up result" />
          <ContentState
            kind="warning"
            title={
              search.verification === 'invalid'
                ? 'Unable to verify this return'
                : 'Top-up result unavailable'
            }
            description="The payment result has not been confirmed."
          />
          <Link to="/wallet" preload={false} className="transfer-back-action">
            Go to wallet
          </Link>
        </div>
      </AppLayout>
    );
  }
  if (!session || !access) return <SignedOutPage />;
  return (
    <PrivateContent access={access}>
      <div
        className="wallet-panel"
        key={`${access.epoch}:${access.user.id}:${access.user.role}:${search.orderId}`}
      >
        <PageHeading title="Top-up result" />
        <ContentState
          kind="warning"
          title="Payment verification is not available yet"
          description="The payment result has not been confirmed."
        />
        <Link to="/wallet" preload={false} className="transfer-back-action">
          Go to wallet
        </Link>
      </div>
    </PrivateContent>
  );
}
