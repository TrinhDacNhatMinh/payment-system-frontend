import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { Button } from 'antd';

import { formatVnd } from '@/shared/lib/vnd';
import {
  createTransferReview,
  getTransferFieldError,
  type TransferDraft,
  type TransferFieldName,
  type TransferReview,
} from '../model/transfer-draft';
import { TransferInput } from './transfer-input';

const FIELD_NAMES = ['toEmail', 'amount', 'description'] as const;
const EMPTY_DRAFT: TransferDraft = { toEmail: '', amount: '', description: null };

export function TransferForm({ submit }: { submit: (review: TransferReview) => Promise<void> }) {
  const id = useId();
  const element = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [review, setReview] = useState<TransferReview | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ name: TransferFieldName } | null>(null);
  const form = useForm({
    defaultValues: EMPTY_DRAFT,
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const invalid = FIELD_NAMES.find((name) => formApi.getFieldMeta(name)?.errors.length);
      if (invalid) setFocusRequest({ name: invalid });
    },
    onSubmit: ({ value }) => {
      // Continue only creates a validated snapshot. Confirm dispatches it later.
      setReview(createTransferReview(value));
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  useLayoutEffect(() => {
    if (review) heading.current?.focus();
    else if (focusRequest) {
      element.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${focusRequest.name}"]`)
        ?.focus();
    }
  }, [review, focusRequest]);

  return (
    <div className="transfer-content">
      {review ? (
        <section aria-labelledby={`${id}-review`} className="transfer-review">
          <h2 id={`${id}-review`} ref={heading} tabIndex={-1}>
            Review transfer
          </h2>
          <dl className="transfer-summary">
            <div>
              <dt>Recipient email</dt>
              <dd>{review.toEmail}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd className="transfer-review-amount">{formatVnd(review.amount)}</dd>
            </div>
            <div>
              <dt>Description</dt>
              <dd className="transfer-description">
                {review.description === null || review.description === ''
                  ? 'No description'
                  : review.description}
              </dd>
            </div>
          </dl>
          <div className="transfer-actions">
            <Button
              htmlType="button"
              onClick={() => {
                setReview(null);
                setFocusRequest({ name: 'toEmail' });
              }}
            >
              Go back
            </Button>
            <Button
              type="primary"
              htmlType="button"
              onClick={() => {
                void submit(review);
              }}
            >
              Confirm transfer
            </Button>
          </div>
        </section>
      ) : (
        <form
          ref={element}
          aria-label="Transfer details"
          aria-busy={isSubmitting}
          className="transfer-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!form.state.isSubmitting) void form.handleSubmit();
          }}
        >
          <fieldset className="transfer-fieldset" disabled={isSubmitting}>
            {FIELD_NAMES.map((name) => (
              <form.Field
                key={name}
                name={name}
                validators={{
                  onBlur: ({ value }) => getTransferFieldError(name, value),
                  onSubmit: ({ value }) => getTransferFieldError(name, value),
                }}
              >
                {(field) => (
                  <TransferInput
                    id={`${id}-${name}`}
                    name={name}
                    value={field.state.value}
                    errors={field.state.meta.errors}
                    disabled={isSubmitting}
                    onBlur={field.handleBlur}
                    onChange={(value) => {
                      const hadErrors = field.state.meta.errors.length > 0;
                      field.handleChange(value);
                      if (hadErrors) void field.validate('blur');
                    }}
                  />
                )}
              </form.Field>
            ))}
            <div className="transfer-actions transfer-entry-actions">
              <Link to="/wallet" preload={false} className="transfer-back-action">
                Go back
              </Link>
              <Button
                type="primary"
                htmlType="submit"
                loading={isSubmitting}
                disabled={isSubmitting}
              >
                Continue
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
