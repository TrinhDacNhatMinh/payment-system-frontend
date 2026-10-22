import { useLayoutEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, Button } from 'antd';

import { formatVnd } from '@/shared/lib/vnd';
import { ContentState } from '@/shared/ui/content-state';
import type { useDepositSubmission } from '../model/use-deposit-submission';
import { DepositForm } from './deposit-form';

export function DepositFlow({ state, operation }: ReturnType<typeof useDepositSubmission>) {
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (state.status === 'resume-review') heading.current?.focus();
  }, [state.status]);
  if (state.status === 'idle') {
    return (
      <>
        {state.message && (
          <Alert type="error" title={state.message} showIcon className="deposit-feedback" />
        )}
        <DepositForm submit={operation.submit} initialAmount={state.draftAmount} />
      </>
    );
  }
  if (state.status === 'resume-review') {
    return (
      <section aria-label="Review previous top-up" className="transfer-review">
        <h2 ref={heading} tabIndex={-1}>
          Review previous top-up
        </h2>
        <dl className="transfer-summary">
          <div>
            <dt>Amount</dt>
            <dd className="transfer-review-amount">{formatVnd(String(state.amount))}</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>VNPay sandbox</dd>
          </div>
        </dl>
        <p className="transfer-field-hint">Continue with the same top-up request.</p>
        <div className="transfer-actions">
          <Button htmlType="button" onClick={operation.cancelResume}>
            Go back
          </Button>
          <Button
            type="primary"
            htmlType="button"
            onClick={() => {
              void operation.resume();
            }}
          >
            Pay with VNPay
          </Button>
        </div>
      </section>
    );
  }
  if (
    state.status === 'initializing' ||
    state.status === 'submitting' ||
    state.status === 'checking'
  ) {
    const title =
      state.status === 'submitting'
        ? 'Preparing your payment…'
        : state.status === 'checking'
          ? 'Checking your top-up…'
          : 'Checking previous top-ups…';
    return <ContentState kind="loading" title={title} />;
  }
  return (
    <div className="wallet-stack">
      {state.status === 'known' ? (
        <>
          <ContentState kind="loading" title="Opening your payment…" />
          <Link to="/payment/result" search={{ orderId: state.orderId }} preload={false}>
            View top-up status
          </Link>
        </>
      ) : (
        <>
          <ContentState
            kind="warning"
            title={state.status === 'blocked' ? 'Top up unavailable' : 'Check your top-up'}
            description={state.message}
          />
          {state.status === 'unknown' && (
            <div className="transfer-actions">
              <Button
                htmlType="button"
                onClick={() => {
                  void operation.checkStatus();
                }}
              >
                Check top-up request
              </Button>
              {state.canResume && (
                <Button htmlType="button" onClick={operation.reviewResume}>
                  Review top-up
                </Button>
              )}
            </div>
          )}
        </>
      )}
      <div>
        <Link to="/wallet" preload={false} className="transfer-back-action">
          Back to wallet
        </Link>
      </div>
    </div>
  );
}
