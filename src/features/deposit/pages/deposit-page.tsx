import { useState } from 'react';
import { Card, Tag } from 'antd';

import { useAuthSession } from '@/features/auth/model/session-context';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { parseDepositGatewayConfig } from '../model/deposit-gateway-config';
import { useDepositSubmission } from '../model/use-deposit-submission';
import { DepositFlow } from '../ui/deposit-flow';
import { DepositForm } from '../ui/deposit-form';

export function DepositPage() {
  const session = useAuthSession();
  const access = session?.controller.getAccessIdentity();
  const [gateway] = useState(() => parseDepositGatewayConfig(import.meta.env));
  if (!access || !session?.privateApi)
    return <ContentState kind="loading" title="Checking your session…" />;
  return (
    <div className="wallet-panel">
      <PageHeading title="Top up" />
      <Card>
        <div className="deposit-method">
          <Tag>VNPay sandbox</Tag>
        </div>
        {gateway ? (
          <ConnectedDeposit
            key={`${access.epoch}:${access.user.id}:${access.user.role}`}
            session={session.controller}
            access={access}
            privateApi={session.privateApi}
            gateway={gateway}
          />
        ) : (
          <DepositForm />
        )}
      </Card>
    </div>
  );
}

function ConnectedDeposit(props: Parameters<typeof useDepositSubmission>[0]) {
  const flow = useDepositSubmission(props);
  return <DepositFlow {...flow} />;
}
