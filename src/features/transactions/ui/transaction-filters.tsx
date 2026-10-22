import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { Button, Card, Input, Select } from 'antd';

import {
  EMPTY_TRANSACTION_FILTERS,
  transactionFilterDraftSchema,
  type TransactionFilterDraft,
} from '../model/transaction-search';

const FILTER_FIELDS = [
  { name: 'type', label: 'Type' },
  { name: 'status', label: 'Status' },
  { name: 'fromDate', label: 'From date' },
  { name: 'toDate', label: 'To date' },
] as const;

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'DEPOSIT', label: 'Top up' },
  { value: 'TRANSFER_IN', label: 'Transfer received' },
  { value: 'TRANSFER_OUT', label: 'Transfer sent' },
];
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'SUCCESS', label: 'Completed' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
];

export function TransactionFilters({
  initialValues,
  apply,
}: {
  initialValues: TransactionFilterDraft;
  apply: (value: TransactionFilterDraft) => Promise<void>;
}) {
  const id = useId();
  const element = useRef<HTMLFormElement>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const form = useForm({
    defaultValues: initialValues,
    canSubmitWhenInvalid: true,
    validators: {
      onChange: transactionFilterDraftSchema,
      onBlur: transactionFilterDraftSchema,
      onSubmit: transactionFilterDraftSchema,
    },
    onSubmitInvalid: () => setFocusRequest((value) => value + 1),
    onSubmit: async ({ value }) => apply(transactionFilterDraftSchema.parse(value)),
  });

  useLayoutEffect(() => {
    if (focusRequest) element.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusRequest]);

  return (
    <Card>
      <form
        ref={element}
        aria-label="Transaction filters"
        className="transaction-filters"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.state.isSubmitting) void form.handleSubmit();
        }}
      >
        {FILTER_FIELDS.map(({ name, label }) => (
          <form.Field key={name} name={name}>
            {(field) => {
              const error = field.state.meta.errors.find((issue) => issue?.message)?.message;
              const showError = Boolean(error && (field.state.meta.isTouched || focusRequest > 0));
              const inputId = `${id}-${name}`;
              return (
                <div className="auth-field">
                  <label htmlFor={inputId}>{label}</label>
                  {name === 'type' || name === 'status' ? (
                    <Select
                      id={inputId}
                      aria-label={label}
                      aria-invalid={showError}
                      aria-describedby={showError ? `${inputId}-error` : undefined}
                      status={showError ? 'error' : undefined}
                      value={field.state.value}
                      options={name === 'type' ? TYPE_OPTIONS : STATUS_OPTIONS}
                      onBlur={field.handleBlur}
                      onChange={(value: string) => {
                        const parsed = transactionFilterDraftSchema.shape[name].safeParse(value);
                        if (parsed.success) field.handleChange(parsed.data);
                      }}
                    />
                  ) : (
                    <Input
                      id={inputId}
                      name={name}
                      type="date"
                      aria-invalid={showError}
                      aria-describedby={showError ? `${inputId}-error` : undefined}
                      status={showError ? 'error' : undefined}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.target.value)}
                    />
                  )}
                  {showError && (
                    <p id={`${inputId}-error`} className="auth-field-error">
                      {error}
                    </p>
                  )}
                </div>
              );
            }}
          </form.Field>
        ))}
        <div className="transaction-filter-actions">
          <Button
            htmlType="button"
            onClick={() => {
              form.reset(EMPTY_TRANSACTION_FILTERS);
              void apply({ ...EMPTY_TRANSACTION_FILTERS });
            }}
          >
            Reset
          </Button>
          <Button htmlType="submit" type="primary">
            Apply
          </Button>
        </div>
      </form>
    </Card>
  );
}
