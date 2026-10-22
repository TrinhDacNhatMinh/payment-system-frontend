import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { Button } from 'antd';

import { formatVnd } from '@/shared/lib/vnd';
import {
  createTransferReview,
  getTransferFieldError,
  getTransferBalanceError,
  type TransferDraft,
  type TransferFieldName,
  type TransferReview,
} from '../model/transfer-draft';
import { TransferInput } from './transfer-input';

const FIELD_NAMES = ['toEmail', 'amount', 'description'] as const;
const EMPTY_DRAFT: TransferDraft = { toEmail: '', amount: '', description: null };

export function TransferForm({
  submit,
  initialValues,
  focusInput = false,
  balance,
  checkRecipient,
}: {
  submit: (review: TransferReview) => Promise<void>;
  initialValues?: TransferDraft;
  focusInput?: boolean;
  balance?: number;
  checkRecipient: (email: string, signal: AbortSignal) => Promise<boolean>;
}) {
  const id = useId();
  const element = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(false);
  const recipientRequest = useRef<{
    email: string;
    controller: AbortController;
    promise: Promise<boolean>;
  } | null>(null);
  const [recipient, setRecipient] = useState<
    | { status: 'idle' }
    | { status: 'checking' | 'valid'; email: string }
    | { status: 'invalid'; email: string; message: string }
  >({ status: 'idle' });
  const [review, setReview] = useState<TransferReview | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ name: TransferFieldName } | null>(
    focusInput ? { name: 'toEmail' } : null,
  );
  const form = useForm({
    defaultValues: initialValues ?? EMPTY_DRAFT,
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const invalid = FIELD_NAMES.find((name) => formApi.getFieldMeta(name)?.errors.length);
      if (invalid) setFocusRequest({ name: invalid });
    },
    onSubmit: async ({ value }) => {
      if (getTransferBalanceError(value.amount, balance)) {
        setFocusRequest({ name: 'amount' });
        return;
      }
      const recipientExists = await validateRecipient(value.toEmail);
      if (!mounted.current) return;
      if (!recipientExists) {
        setFocusRequest({ name: 'toEmail' });
        return;
      }
      // Continue only creates a validated snapshot. Confirm dispatches it later.
      setReview(createTransferReview(value));
    },
  });
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recipientRequest.current?.controller.abort();
      recipientRequest.current = null;
    };
  }, []);

  async function validateRecipient(value: string): Promise<boolean> {
    if (getTransferFieldError('toEmail', value)) return false;
    const email = value.trim();
    if (recipientRequest.current?.email === email) return recipientRequest.current.promise;
    recipientRequest.current?.controller.abort();
    const controller = new AbortController();
    setRecipient({ status: 'checking', email });
    const promise = (async () => {
      try {
        const exists = await checkRecipient(email, controller.signal);
        if (controller.signal.aborted) return false;
        setRecipient(
          exists
            ? { status: 'valid', email }
            : {
                status: 'invalid',
                email,
                message: 'No account was found with this email address.',
              },
        );
        return exists;
      } catch {
        if (!controller.signal.aborted)
          setRecipient({
            status: 'invalid',
            email,
            message: 'Unable to check this recipient. Please try again.',
          });
        return false;
      }
    })();
    recipientRequest.current = { email, controller, promise };
    void promise.then((exists) => {
      if (!exists && recipientRequest.current?.controller === controller)
        recipientRequest.current = null;
    });
    return promise;
  }

  const reviewBalanceError = review ? getTransferBalanceError(review.amount, balance) : undefined;

  useLayoutEffect(() => {
    if (review) heading.current?.focus();
    else if (focusRequest) {
      element.current
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${focusRequest.name}"]`)
        ?.focus();
    }
  }, [review, focusRequest, isSubmitting]);

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
          {reviewBalanceError && (
            <p role="alert" className="transfer-field-error">
              {reviewBalanceError}
            </p>
          )}
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
              disabled={Boolean(reviewBalanceError)}
              onClick={() => {
                if (!reviewBalanceError) void submit(review);
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
                    errors={[
                      ...field.state.meta.errors,
                      ...(name === 'amount'
                        ? [getTransferBalanceError(field.state.value, balance)]
                        : []),
                      ...(name === 'toEmail' &&
                      recipient.status === 'invalid' &&
                      recipient.email === field.state.value?.trim()
                        ? [recipient.message]
                        : []),
                    ]}
                    checking={name === 'toEmail' && recipient.status === 'checking'}
                    disabled={isSubmitting}
                    onBlur={() => {
                      field.handleBlur();
                      if (name === 'toEmail') void validateRecipient(field.state.value ?? '');
                    }}
                    onChange={(value) => {
                      if (name === 'toEmail' && value.trim() !== field.state.value?.trim()) {
                        recipientRequest.current?.controller.abort();
                        recipientRequest.current = null;
                        setRecipient({ status: 'idle' });
                      }
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
                Back to wallet
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
