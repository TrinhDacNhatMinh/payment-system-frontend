import type { ChangeEvent } from 'react';
import { Input } from 'antd';

type AuthInputProps = {
  id: string;
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'password';
  value: string;
  autoComplete: string;
  disabled: boolean;
  errors: readonly unknown[];
  onChange: (value: string) => void;
  onBlur: () => void;
  hint?: string;
};

function getErrorMessage(errors: readonly unknown[]) {
  const error = errors[0];
  if (typeof error === 'string') return error;
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return undefined;
}

export function AuthInput({ label, errors, hint, type, ...props }: AuthInputProps) {
  const message = getErrorMessage(errors);
  const helpId = `${props.id}-help`;
  const sharedProps = {
    ...props,
    onChange: (event: ChangeEvent<HTMLInputElement>) => props.onChange(event.target.value),
    'aria-invalid': Boolean(message),
    'aria-describedby': message || hint ? helpId : undefined,
    required: true,
    status: message ? ('error' as const) : undefined,
  };

  return (
    <div className="auth-field">
      <label htmlFor={props.id}>
        {label}{' '}
        <span aria-hidden="true" className="auth-required">
          *
        </span>
      </label>
      {type === 'password' ? (
        <Input.Password {...sharedProps} />
      ) : (
        <Input {...sharedProps} type={type} />
      )}
      {(message || hint) && (
        <p id={helpId} className={message ? 'auth-field-error' : 'auth-field-hint'}>
          {message || hint}
        </p>
      )}
    </div>
  );
}
