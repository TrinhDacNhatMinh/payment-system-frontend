import { useId, useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircleFilled } from '@ant-design/icons';
import { Alert, Button, Spin } from 'antd';

import { formatReceiptMoney, formatReceiptTime } from '../model/transfer-receipt';
import type { TransferSubmissionState } from '../model/transfer-submission';

export function TransferResult({
  state,
  checkStatus,
}: {
  state: TransferSubmissionState;
  checkStatus: () => Promise<void>;
}) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    heading.current?.focus();
  }, [state.status]);
  const back = (
    <Link to="/wallet" preload={false} className="transfer-back-action">
      Go to wallet
    </Link>
  );

  if (state.status === 'idle') return null;
  if (
    state.status === 'initializing' ||
    state.status === 'submitting' ||
    state.status === 'checking'
  ) {
    const title = state.status === 'submitting' ? 'Sending transfer…' : 'Checking transfer…';
    return (
      <section aria-busy="true" aria-labelledby={id}>
        <h2 id={id} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <Spin />
        <p className="transfer-field-hint">
          Leaving this page does not cancel a submitted transfer.
        </p>
      </section>
    );
  }
  if (state.status === 'success')
    return (
      <section className="transfer-receipt" aria-labelledby={id}>
        <div className="transfer-receipt-header">
          <CheckCircleFilled className="transfer-receipt-icon" aria-hidden="true" />
          <h2 id={id} ref={heading} tabIndex={-1}>
            Transfer successful
          </h2>
          <p className="transfer-receipt-amount">{formatReceiptMoney(state.receipt.amount)}</p>
        </div>
        <dl className="transfer-summary">
          <div>
            <dt>To</dt>
            <dd>{state.request.toEmail}</dd>
          </div>
          {state.request.description?.trim() && (
            <div>
              <dt>Message</dt>
              <dd className="transfer-description">{state.request.description}</dd>
            </div>
          )}
          <div>
            <dt>Date &amp; time</dt>
            <dd>
              <time dateTime={state.receipt.createdAt}>
                {formatReceiptTime(state.receipt.createdAt)}
              </time>
            </dd>
          </div>
        </dl>
        {state.walletRefresh === 'error' && (
          <Alert
            type="warning"
            showIcon
            role="alert"
            title="Transfer succeeded. Your current balance could not be updated."
          />
        )}
        {state.legacyFractional && (
          <Alert
            type="warning"
            showIcon
            title="Historical transfer: fractional amounts are shown exactly."
          />
        )}
        <div className="transfer-actions">{back}</div>
      </section>
    );
  return (
    <section aria-labelledby={id}>
      <h2 id={id} ref={heading} tabIndex={-1}>
        {state.status === 'unknown'
          ? 'Transfer outcome is unknown'
          : state.status === 'rejected'
            ? 'Transfer declined'
            : 'Transfer unavailable'}
      </h2>
      <Alert
        type={state.status === 'unknown' ? 'warning' : 'error'}
        showIcon
        role="alert"
        title={state.message}
      />
      <div className="transfer-actions">
        {back}
        {state.status === 'unknown' && (
          <Button
            htmlType="button"
            type="primary"
            onClick={() => {
              void checkStatus();
            }}
          >
            Check transfer status
          </Button>
        )}
      </div>
    </section>
  );
}
