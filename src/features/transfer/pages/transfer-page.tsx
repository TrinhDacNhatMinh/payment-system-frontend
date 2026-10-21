import { Link } from '@tanstack/react-router';
import { Card } from 'antd';

import { PageHeading } from '@/shared/ui/page-heading';

export function TransferPage() {
  return (
    <div className="transfer-panel">
      <PageHeading title="Transfer" />
      <Card>
        <p>Transfers are not available yet.</p>
        <Link to="/wallet" preload={false}>
          Back to wallet
        </Link>
      </Card>
    </div>
  );
}
