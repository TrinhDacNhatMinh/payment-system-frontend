import { Card, Tag } from 'antd';

import { PageHeading } from '@/shared/ui/page-heading';
import { DepositForm } from '../ui/deposit-form';

export function DepositPage() {
  return (
    <div className="wallet-panel">
      <PageHeading title="Top up" />
      <Card>
        <div className="deposit-method">
          <Tag>VNPay sandbox</Tag>
        </div>
        <DepositForm />
      </Card>
    </div>
  );
}
