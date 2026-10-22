import { useId, useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircleFilled } from '@ant-design/icons';
import { Alert, Button, Spin } from 'antd';

import { formatReceiptMoney, formatReceiptTime } from '../model/transfer-receipt';
import type { TransferSubmissionState } from '../model/transfer-submission';

export function TransferResult({
  state,
  checkStatus,
  reviewResume,
  cancelResume,
  resume,
  newTransfer,
}: {
  state: TransferSubmissionState;
  checkStatus: () => Promise<void>;
  reviewResume: () => void;
  cancelResume: () => void;
  resume: () => Promise<void>;
  newTransfer: () => void;
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
  if (state.status === 'resume-review')
    return (
      <section className="transfer-review" aria-labelledby={id}>
        <h2 id={id} ref={heading} tabIndex={-1}>
          Review pending transfer
        </h2>
        <p>This continues your earlier transfer. Review the details before confirming.</p>
        <dl className="transfer-summary">
          <div>
            <dt>To</dt>
            <dd>{state.payload.toEmail}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd className="transfer-review-amount">{formatReceiptMoney(state.payload.amount)}</dd>
          </div>
          {state.payload.description?.trim() && (
            <div>
              <dt>Message</dt>
              <dd className="transfer-description">{state.payload.description}</dd>
            </div>
          )}
        </dl>
        <div className="transfer-actions">
          <Button htmlType="button" onClick={cancelResume}>
            Go back
          </Button>
          <Button
            htmlType="button"
            type="primary"
            onClick={() => {
              void resume();
            }}
          >
            Confirm and resume
          </Button>
        </div>
      </section>
    );
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
        {state.restartError && (
          <Alert type="warning" showIcon role="alert" title={state.restartError} />
        )}
        <div className="transfer-actions">
          {back}
          <Button htmlType="button" onClick={newTransfer}>
            Make another transfer
          </Button>
        </div>
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
      {state.status === 'unknown' && state.readOnlyDetails && (
        <dl className="transfer-summary transfer-recovery-details">
          <div>
            <dt>To</dt>
            <dd>{state.readOnlyDetails.toEmail}</dd>
          </div>
          <div>
            <dt>Amount</dt>
            <dd>{formatReceiptMoney(state.readOnlyDetails.amount)}</dd>
          </div>
          {state.readOnlyDetails.description?.trim() && (
            <div>
              <dt>Message</dt>
              <dd className="transfer-description">{state.readOnlyDetails.description}</dd>
            </div>
          )}
        </dl>
      )}
      {state.status === 'rejected' && state.restartError && (
        <Alert type="warning" showIcon role="alert" title={state.restartError} />
      )}
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
        {state.status === 'unknown' && state.recovery && (
          <Button htmlType="button" onClick={reviewResume}>
            Review and resume transfer
          </Button>
        )}
        {state.status === 'rejected' && (
          <Button htmlType="button" type="primary" onClick={newTransfer}>
            Edit transfer details
          </Button>
        )}
      </div>
    </section>
  );
}
