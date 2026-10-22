import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  EyeInvisibleOutlined,
  EyeOutlined,
  HistoryOutlined,
  PlusCircleOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { Link } from '@tanstack/react-router';
import { Alert, Button, Card, Spin } from 'antd';

import type { SessionAccess } from '@/features/auth/model/session-access';
import { useAuthSession } from '@/features/auth/model/session-context';
import type { SessionController } from '@/features/auth/model/session-controller';
import { normalizeApiError } from '@/shared/api/api-error';
import type { ApiTransport } from '@/shared/api/http-client';
import { ContentState } from '@/shared/ui/content-state';
import { PageHeading } from '@/shared/ui/page-heading';
import { walletQueryOptions } from '../api/wallet-query';
import { formatWalletBalance } from '../model/wallet-display';

export function WalletPage() {
  const session = useAuthSession();
  const access = session?.controller.getAccessIdentity();
  if (!session?.privateApi || !access) {
    return <ContentState kind="loading" title="Checking your session…" />;
  }
  return (
    <WalletContent
      key={`${access.epoch}:${access.user.id}:${access.user.role}`}
      session={session.controller}
      access={access}
      api={session.privateApi(access)}
    />
  );
}

function WalletContent({
  session,
  access,
  api,
}: {
  session: SessionController;
  access: SessionAccess;
  api: ApiTransport;
}) {
  const [isBalanceVisible, setIsBalanceVisible] = useState(true);
  const query = useQuery(walletQueryOptions({ session, access, api }));
  const error = query.error ? normalizeApiError(query.error) : null;
  const unavailable = error?.code === 'WALLET_NOT_FOUND';
  const accessRejected = error?.status === 401 || error?.status === 403;
  const wallet = unavailable || accessRejected ? undefined : query.data;
  let balance: string | undefined;
  if (wallet) {
    try {
      balance = formatWalletBalance(wallet.balance);
    } catch {
      // Never replace an unsupported numeric response with zero or rounding.
      balance = undefined;
    }
  }
  const retry = () => {
    if (!query.isFetching) void query.refetch({ cancelRefetch: false });
  };

  return (
    <div className="wallet-panel">
      <PageHeading title="My wallet" />
      <div className="wallet-stack">
        {query.isPending ? (
          <Card>
            <section
              className="wallet-loading"
              role="status"
              aria-label="Loading your wallet"
              aria-busy="true"
            >
              <Spin />
            </section>
          </Card>
        ) : !wallet ? (
          <ContentState
            kind={unavailable ? 'warning' : 'error'}
            title={unavailable ? 'Wallet not found' : 'Unable to load your wallet'}
            description={
              unavailable
                ? 'No wallet was found for your account.'
                : (error?.message ?? 'Your wallet is unavailable. Please try again.')
            }
            onRetry={retry}
          />
        ) : balance === undefined ? (
          <ContentState
            kind="error"
            title="Balance unavailable"
            description="The balance could not be displayed reliably. Please try again later."
            onRetry={retry}
          />
        ) : (
          <Card className="wallet-balance-card">
            <section aria-labelledby="wallet-balance-title" aria-busy={query.isFetching}>
              <div className="wallet-balance-heading">
                <h2 id="wallet-balance-title">
                  {error ? 'Last known balance' : 'Available balance'}
                </h2>
                <Button
                  htmlType="button"
                  type="text"
                  shape="circle"
                  className="wallet-visibility"
                  icon={
                    isBalanceVisible ? (
                      <EyeInvisibleOutlined aria-hidden="true" />
                    ) : (
                      <EyeOutlined aria-hidden="true" />
                    )
                  }
                  aria-label={isBalanceVisible ? 'Hide balance' : 'Show balance'}
                  title={isBalanceVisible ? 'Hide balance' : 'Show balance'}
                  onClick={() => setIsBalanceVisible((visible) => !visible)}
                />
              </div>
              <output
                className={`wallet-balance${isBalanceVisible && balance.length > 16 ? ' wallet-balance-long' : ''}`}
                aria-label={
                  isBalanceVisible ? `Available balance: ${balance} VND` : 'Balance hidden'
                }
                aria-live="off"
              >
                <span className="wallet-number">{isBalanceVisible ? balance : '••••••'}</span>
                <span className="wallet-currency">VND</span>
              </output>
            </section>
            {error && (
              <Alert
                className="wallet-refresh-error"
                type="warning"
                showIcon
                role="alert"
                title="Couldn’t refresh balance"
              />
            )}
          </Card>
        )}
        <div className="wallet-actions">
          <Link to="/transfer" preload={false} className="wallet-transfer-link">
            <SwapOutlined aria-hidden="true" /> Transfer
          </Link>
          <Link to="/deposit" preload={false} className="wallet-transfer-link">
            <PlusCircleOutlined aria-hidden="true" /> Top up
          </Link>
          <Link to="/transactions" preload={false} className="wallet-transfer-link">
            <HistoryOutlined aria-hidden="true" /> Transaction history
          </Link>
        </div>
      </div>
    </div>
  );
}
