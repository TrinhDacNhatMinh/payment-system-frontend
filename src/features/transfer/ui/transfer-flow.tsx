import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from 'antd';

import type { PrivateApiFactory } from '@/features/auth/api/private-api';
import type { SessionAccess } from '@/features/auth/model/session-access';
import type { SessionController } from '@/features/auth/model/session-controller';
import { walletQueryOptions } from '@/features/wallet/api/wallet-query';
import { createRecipientApi } from '../api/recipient-api';
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
  const [checkRecipient] = useState(() => createRecipientApi(props.privateApi, props.access));
  const wallet = useQuery(walletQueryOptions({ ...props, api: props.privateApi(props.access) }));
  const availableBalance =
    !wallet.error &&
    wallet.data &&
    Number.isSafeInteger(wallet.data.balance) &&
    wallet.data.balance >= 0
      ? wallet.data.balance
      : undefined;
  const balance = (
    <TransferBalance
      data={wallet.data}
      error={wallet.error}
      isPending={wallet.isPending}
      isFetching={wallet.isFetching}
    />
  );
  return (
    <Card className="transfer-card">
      <div hidden={operation.state.status === 'success'}>{balance}</div>
      {operation.state.status === 'idle' ? (
        <TransferForm
          submit={operation.submit}
          initialValues={operation.state.draft}
          focusInput={operation.state.focusInput}
          balance={availableBalance}
          checkRecipient={checkRecipient}
        />
      ) : (
        <TransferResult
          state={operation.state}
          checkStatus={operation.checkStatus}
          reviewResume={operation.reviewResume}
          cancelResume={operation.cancelResume}
          resume={operation.resume}
          newTransfer={operation.newTransfer}
        />
      )}
    </Card>
  );
}
