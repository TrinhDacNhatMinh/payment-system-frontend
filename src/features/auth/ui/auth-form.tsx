import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { Alert, Button } from 'antd';

import { getAuthFormFeedback } from '../model/auth-form-feedback';
import {
  loginFormSchema,
  registerFormSchema,
  type AuthFormValues,
} from '../schemas/auth-form-schemas';
import { AuthInput } from './auth-input';

type AuthFormProps = {
  mode: 'login' | 'register';
  submit?: (values: AuthFormValues, signal: AbortSignal) => Promise<void>;
  onSuccess?: () => void;
};

const fieldPresentation = {
  fullName: { label: 'Full name', type: 'text', autoComplete: 'name' },
  email: { label: 'Email address', type: 'email', autoComplete: 'username' },
  phone: { label: 'Phone number', type: 'tel', autoComplete: 'tel' },
  password: { label: 'Password', type: 'password', autoComplete: 'current-password' },
} as const;

export function AuthForm({ mode, submit, onSuccess }: AuthFormProps) {
  const id = useId();
  const element = useRef<HTMLFormElement>(null);
  const request = useRef<AbortController | null>(null);
  const [feedback, setFeedback] = useState<ReturnType<typeof getAuthFormFeedback> | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ name: keyof AuthFormValues } | null>(null);
  const fieldNames =
    mode === 'register'
      ? (['fullName', 'email', 'phone', 'password'] as const)
      : (['email', 'password'] as const);
  const fieldSchemas = mode === 'register' ? registerFormSchema.shape : loginFormSchema.shape;

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  const form = useForm({
    defaultValues: { fullName: '', email: '', phone: '', password: '' },
    // Keep the submit path available so it validates every field even when
    // an earlier blur already found an error. Invalid values still cannot submit.
    canSubmitWhenInvalid: true,
    onSubmitInvalid: ({ formApi }) => {
      const invalid = fieldNames.find((name) => formApi.getFieldMeta(name)?.errors.length);
      if (invalid) setFocusRequest({ name: invalid });
    },
    onSubmit: async ({ value, formApi }) => {
      if (!submit || feedback?.uncertain || request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setFeedback(null);
      try {
        await submit({ ...value }, controller.signal);
        if (!controller.signal.aborted) {
          formApi.setFieldValue('password', '');
          onSuccess?.();
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          formApi.setFieldValue('password', '');
          setFeedback(getAuthFormFeedback(error, mode));
        }
      } finally {
        if (request.current === controller) request.current = null;
      }
    },
  });

  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);

  // Invalid submission resets the store before React has necessarily removed
  // disabled from the fieldset. Focus only after that DOM update is committed.
  useLayoutEffect(() => {
    if (focusRequest) {
      element.current?.querySelector<HTMLInputElement>(`[name="${focusRequest.name}"]`)?.focus();
    }
  }, [focusRequest]);

  return (
    <form
      ref={element}
      aria-label={mode === 'register' ? 'Create account' : 'Sign in'}
      aria-busy={isSubmitting}
      className="auth-form flex flex-col gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!submit || form.state.isSubmitting || feedback?.uncertain) return;
        void form.handleSubmit();
      }}
    >
      {!submit && (
        <Alert
          type="warning"
          showIcon
          title={
            mode === 'register'
              ? 'Registration is not available yet.'
              : 'Sign in is not available yet.'
          }
        />
      )}
      {feedback && (
        <Alert
          type={feedback.type}
          role="alert"
          showIcon
          title={feedback.title}
          description={feedback.description}
        />
      )}
      <fieldset className="auth-fieldset flex flex-col gap-6" disabled={isSubmitting}>
        {fieldNames.map((name) => {
          const schema =
            name === 'fullName' || name === 'phone'
              ? registerFormSchema.shape[name]
              : fieldSchemas[name];
          return (
            <form.Field key={name} name={name} validators={{ onBlur: schema, onSubmit: schema }}>
              {(field) => (
                <AuthInput
                  {...fieldPresentation[name]}
                  id={`${id}-${name}`}
                  name={name}
                  value={field.state.value}
                  autoComplete={
                    name === 'password' && mode === 'register'
                      ? 'new-password'
                      : fieldPresentation[name].autoComplete
                  }
                  disabled={isSubmitting}
                  errors={field.state.meta.errors}
                  hint={
                    name === 'password' && mode === 'register'
                      ? 'At least 6 characters.'
                      : undefined
                  }
                  onBlur={field.handleBlur}
                  onChange={(value) => {
                    const hadErrors = field.state.meta.errors.length > 0;
                    field.handleChange(value);
                    if (hadErrors) void field.validate('blur');
                  }}
                />
              )}
            </form.Field>
          );
        })}
        <Button
          type="primary"
          htmlType="submit"
          block
          loading={isSubmitting}
          disabled={!submit || isSubmitting || Boolean(feedback?.uncertain)}
          aria-label={mode === 'register' ? 'Create account' : 'Sign in'}
        >
          {isSubmitting
            ? mode === 'register'
              ? 'Creating your account…'
              : 'Signing in…'
            : mode === 'register'
              ? 'Create account'
              : 'Sign in'}
        </Button>
      </fieldset>
      {feedback?.uncertain && mode === 'login' && (
        <Button htmlType="button" onClick={() => setFeedback(null)}>
          Review sign-in
        </Button>
      )}
    </form>
  );
}
