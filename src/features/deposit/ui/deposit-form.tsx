import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { Button, Input } from 'antd';

import { formatVnd } from '@/shared/lib/vnd';
import { depositAmountInputSchema } from '../api/deposit-schemas';

function getAmountError(value: string) {
  const result = depositAmountInputSchema.safeParse(value);
  return result.success ? undefined : result.error.issues[0]?.message;
}

export function DepositForm() {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [reviewAmount, setReviewAmount] = useState<number | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const form = useForm({
    defaultValues: { amount: '' },
    canSubmitWhenInvalid: true,
    onSubmitInvalid: () => setFocusRequest((request) => request + 1),
    onSubmit: ({ value }) => {
      const result = depositAmountInputSchema.safeParse(value.amount);
      if (result.success) setReviewAmount(result.data);
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  useLayoutEffect(() => {
    if (isSubmitting) return;
    if (reviewAmount !== null) heading.current?.focus();
    else if (focusRequest > 0) input.current?.focus();
  }, [reviewAmount, focusRequest, isSubmitting]);

  if (reviewAmount !== null) {
    return (
      <section aria-labelledby={`${id}-review`} className="transfer-review">
        <h2 id={`${id}-review`} ref={heading} tabIndex={-1}>
          Review top-up
        </h2>
        <dl className="transfer-summary">
          <div>
            <dt>Amount</dt>
            <dd className="transfer-review-amount">{formatVnd(String(reviewAmount))}</dd>
          </div>
          <div>
            <dt>Payment method</dt>
            <dd>VNPay sandbox</dd>
          </div>
        </dl>
        <p className="transfer-field-hint">Payment is not available yet.</p>
        <div className="transfer-actions">
          <Button
            htmlType="button"
            onClick={() => {
              setReviewAmount(null);
              setFocusRequest((request) => request + 1);
            }}
          >
            Go back
          </Button>
          <Button type="primary" htmlType="button" disabled>
            Pay with VNPay
          </Button>
        </div>
      </section>
    );
  }

  return (
    <form
      aria-label="Top-up details"
      aria-busy={isSubmitting}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.state.isSubmitting) void form.handleSubmit();
      }}
    >
      <fieldset className="transfer-fieldset" disabled={isSubmitting}>
        <form.Field
          name="amount"
          validators={{
            onBlur: ({ value }) => getAmountError(value),
            onSubmit: ({ value }) => getAmountError(value),
          }}
        >
          {(field) => {
            const error = field.state.meta.errors.find(
              (message): message is string => typeof message === 'string',
            );
            return (
              <div className="transfer-field">
                <label htmlFor={`${id}-amount`}>
                  Amount <span aria-hidden="true">*</span>
                </label>
                <Input
                  ref={(instance) => {
                    input.current = instance?.input ?? null;
                  }}
                  id={`${id}-amount`}
                  name="amount"
                  className="transfer-control"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  suffix="VND"
                  required
                  value={field.state.value}
                  disabled={isSubmitting}
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? `${id}-amount-error` : undefined}
                  status={error ? 'error' : undefined}
                  onBlur={field.handleBlur}
                  onChange={(event) => {
                    const hadErrors = field.state.meta.errors.length > 0;
                    field.handleChange(event.target.value);
                    if (hadErrors) void field.validate('blur');
                  }}
                />
                {error && (
                  <p id={`${id}-amount-error`} className="transfer-field-error">
                    {error}
                  </p>
                )}
              </div>
            );
          }}
        </form.Field>
        <div className="transfer-actions transfer-entry-actions">
          <Link to="/wallet" preload={false} className="transfer-back-action">
            Back to wallet
          </Link>
          <Button type="primary" htmlType="submit" loading={isSubmitting} disabled={isSubmitting}>
            Continue
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
