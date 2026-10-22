import { useId, useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircleFilled, ClockCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Alert, Button, Card } from 'antd';

import { formatVnd } from '@/shared/lib/vnd';
import { ContentState } from '@/shared/ui/content-state';
import type { DepositResultState } from '../model/deposit-result';

function formatPaymentTime(value: string) {
  return `${value.slice(11, 16)} ${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} (GMT+7)`;
}

export function DepositResult({
  state,
  operation,
}: {
  state: DepositResultState;
  operation: {
    checkStatus: () => Promise<void>;
  };
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [state.status]);
  const walletLink = (
    <Link to="/wallet" preload={false} className="transfer-back-action">
      Back to wallet
    </Link>
  );
  if (state.status === 'loading')
    return <ContentState kind="loading" title="Checking your payment…" />;
  if (state.status === 'blocked')
    return (
      <ContentState
        kind="warning"
        title="Sign in to check your payment"
        description="Your session changed. Your payment result has not been confirmed."
      />
    );
  if (state.status === 'unavailable') {
    return (
      <Card>
        <div className="wallet-stack">
          <ContentState
            kind="warning"
            title="Payment status unavailable"
            description={state.message}
          />
          <div className="transfer-actions">
            {walletLink}
            <Button
              htmlType="button"
              aria-label="Check status"
              aria-busy={state.busy}
              loading={state.busy}
              disabled={state.busy}
              onClick={() => {
                void operation.checkStatus();
              }}
            >
              Check status
            </Button>
          </div>
        </div>
      </Card>
    );
  }
  const success = state.status === 'success';
  const failed = state.status === 'failed';
  const pending = state.status === 'pending';
  const title = success ? 'Top-up successful' : failed ? 'Top-up unsuccessful' : 'Payment pending';
  return (
    <Card>
      <section className="transfer-receipt" aria-labelledby={id}>
        <div className="transfer-receipt-header">
          {success ? (
            <CheckCircleFilled className="transfer-receipt-icon" aria-hidden="true" />
          ) : failed ? (
            <CloseCircleOutlined className="deposit-failed-icon" aria-hidden="true" />
          ) : (
            <ClockCircleOutlined className="deposit-pending-icon" aria-hidden="true" />
          )}
          <h2 id={id} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <p className="transfer-receipt-amount">{formatVnd(String(state.order.amount))}</p>
          <p className="transfer-field-hint">
            {success
              ? 'The money has been added to your wallet.'
              : failed
                ? 'This top-up did not add money to your wallet.'
                : 'We are waiting for payment confirmation.'}
          </p>
        </div>
        <dl className="transfer-summary">
          <div>
            <dt>Payment method</dt>
            <dd>VNPay sandbox</dd>
          </div>
          <div>
            <dt>Reference</dt>
            <dd>{state.order.orderId}</dd>
          </div>
          {success && state.order.paidAt && (
            <div>
              <dt>Completed at</dt>
              <dd>{formatPaymentTime(state.order.paidAt)}</dd>
            </div>
          )}
        </dl>
        {pending && !state.automatic && (
          <p className="transfer-field-hint">
            Confirmation is taking longer. You can return to your wallet.
          </p>
        )}
        {pending && state.message && <Alert type="warning" title={state.message} showIcon />}
        {success && state.wallet === 'updating' && <p role="status">Updating your balance…</p>}
        {success && state.wallet === 'error' && (
          <Alert
            className="deposit-feedback"
            type="warning"
            title="Top-up successful. Your balance could not be refreshed."
            showIcon
          />
        )}
        {(success || failed) && !state.canStartNew && (
          <Alert
            className="deposit-feedback"
            type="warning"
            title="Your payment result is confirmed. Check your previous top-up before starting another."
            showIcon
          />
        )}
        <div className="transfer-actions deposit-result-actions">
          {walletLink}
          {state.canStartNew && (
            <Link to="/deposit" preload={false} className="wallet-transfer-link">
              Continue
            </Link>
          )}
        </div>
      </section>
    </Card>
  );
}
