import { Card } from 'antd';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { useTransferSubmission } from '../model/use-transfer-submission';
import { TransferBalance } from './transfer-balance';
import { TransferForm } from './transfer-form';
import { TransferResult } from './transfer-result';

export function TransferFlow(props: {
  session: SessionController;
  access: SessionAccess;
  privateApi: PrivateApiFactory;
}) {
  const operation = useTransferSubmission(props);
  const balance = (
    <TransferBalance
      session={props.session}
      access={props.access}
      api={props.privateApi(props.access)}
    />
  );
  return (
    <Card className="transfer-card">
      <div hidden={operation.state.status === 'success'}>{balance}</div>
      {operation.state.status === 'idle' ? (
        <TransferForm submit={operation.submit} />
      ) : (
        <TransferResult state={operation.state} checkStatus={operation.checkStatus} />
      )}
    </Card>
  );
}
