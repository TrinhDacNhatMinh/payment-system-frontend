import { Link, useLocation } from '@tanstack/react-router';

import { AppLayout } from '@/app/layouts/app-layout';
import { PrivateContent } from '@/app/layouts/private-content';
import { SignedOutPage } from '@/app/layouts/signed-out-page';
import { useAuthSession } from '@/features/auth/model/session-context';
import { parsePaymentResultSearch } from '@/shared/lib/payment-result-context';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { useDepositResult } from '../model/use-deposit-result';
import { DepositResult } from '../ui/deposit-result';
import { VnpayReturnPage } from './vnpay-return-page';

export function PaymentResultPage() {
  const location = useLocation();
  const search = parsePaymentResultSearch(location.search);
  const session = useAuthSession();
  const access = session?.controller.getAccessIdentity();
  // Router hash data can be decoded; use the raw href to preserve signed parameter encoding.
  const fragment = location.href.includes('#')
    ? location.href.slice(location.href.indexOf('#') + 1)
    : '';
  if (search.orderId && new URLSearchParams(fragment).has('vnpayReturn')) {
    return <VnpayReturnPage orderId={search.orderId} fragment={fragment} />;
  }
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
        {session.privateApi ? (
          <ConnectedResult
            orderId={search.orderId}
            session={session.controller}
            access={access}
            privateApi={session.privateApi}
          />
        ) : (
          <ContentState
            kind="warning"
            title="Payment status unavailable"
            description="The payment result has not been confirmed."
          />
        )}
      </div>
    </PrivateContent>
  );
}

function ConnectedResult(props: Parameters<typeof useDepositResult>[0]) {
  const result = useDepositResult(props);
  return <DepositResult {...result} />;
}
