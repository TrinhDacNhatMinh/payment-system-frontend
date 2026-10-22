import type { ChangeEvent } from 'react';
import { Input } from 'antd';

import type { TransferFieldName } from '../model/transfer-draft';

type TransferInputProps = {
  id: string;
  name: TransferFieldName;
  value: string | null;
  errors: readonly unknown[];
  disabled: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
};

const presentation = {
  toEmail: { label: 'Recipient email' },
  amount: { label: 'Amount' },
  description: { label: 'Description' },
};

export function TransferInput(props: TransferInputProps) {
  const { label } = presentation[props.name];
  const message = props.errors.find((error): error is string => typeof error === 'string');
  const helpId = `${props.id}-help`;
  const control = {
    className: 'transfer-control',
    id: props.id,
    name: props.name,
    value: props.value ?? '',
    disabled: props.disabled,
    onBlur: props.onBlur,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      if (props.name === 'amount' && !/^\d*$/.test(value)) return;
      props.onChange(props.name === 'description' ? value.slice(0, 255) : value);
    },
    required: props.name !== 'description',
    'aria-invalid': Boolean(message),
    'aria-describedby': message ? helpId : undefined,
    status: message ? ('error' as const) : undefined,
  };

  return (
    <div className="transfer-field">
      <label htmlFor={props.id}>
        {label}
        {props.name !== 'description' && <span aria-hidden="true"> *</span>}
      </label>
      {props.name === 'description' ? (
        <Input.TextArea {...control} maxLength={255} autoSize={{ minRows: 3, maxRows: 6 }} />
      ) : (
        <Input
          {...control}
          type={props.name === 'toEmail' ? 'email' : 'text'}
          inputMode={props.name === 'amount' ? 'numeric' : 'email'}
          autoComplete="off"
          suffix={props.name === 'amount' ? 'VND' : undefined}
        />
      )}
      {message && (
        <p id={helpId} className="transfer-field-error">
          {message}
        </p>
      )}
    </div>
  );
}
