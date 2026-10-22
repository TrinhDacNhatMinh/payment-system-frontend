import { Link } from '@tanstack/react-router';

import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';

export function DepositPage() {
  return (
    <div className="wallet-panel">
      <PageHeading title="Top up" />
      <div className="wallet-stack">
        <ContentState
          kind="warning"
          title="VNPay sandbox"
          description="Top up is not available yet."
        />
        <div>
          <Link to="/wallet" preload={false} className="transfer-back-action">
            Back to wallet
          </Link>
        </div>
      </div>
    </div>
  );
}
