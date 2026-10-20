import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/shared/api/api-error';
import { AuthRequestError } from '../api/auth-api';
import { AuthForm } from './auth-form';

function renderForm(props: ComponentProps<typeof AuthForm>) {
  return render(
    <ConfigProvider locale={enUS} theme={{ token: { motion: false } }}>
      <AuthForm {...props} />
    </ConfigProvider>,
  );
}

async function fillLogin(password = ' secret ') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Email address/), 'member@example.com');
  await user.type(screen.getByLabelText(/^Password/), password);
  return user;
}

async function fillRegistration() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Full name/), 'Member');
  await user.type(screen.getByLabelText(/^Email address/), 'member@example.com');
  await user.type(screen.getByLabelText(/^Phone number/), 'any phone');
  await user.type(screen.getByLabelText(/^Password/), 'secret');
  return user;
}

describe('auth form interaction', () => {
  it('starts without field errors and focuses the first invalid input after submit', async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    renderForm({ mode: 'register', submit });
    expect(screen.queryByText('Enter your full name.')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/^Full name/));
    await user.tab();
    await screen.findByText('Enter your full name.');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Enter your phone number.');
    await waitFor(() => expect(screen.getByLabelText(/^Full name/)).toHaveFocus());
    expect(screen.getByLabelText(/^Full name/)).toHaveAttribute('aria-invalid', 'true');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(screen.getByLabelText(/^Full name/)).toHaveFocus());
    expect(submit).not.toHaveBeenCalled();
  });

  it('validates on blur and clears an existing error while correcting the value', async () => {
    renderForm({ mode: 'login', submit: vi.fn() });
    const user = userEvent.setup();
    const email = screen.getByLabelText(/^Email address/);
    await user.type(email, 'incorrect');
    expect(screen.queryByText('Enter a valid email address.')).not.toBeInTheDocument();
    await user.tab();
    await screen.findByText('Enter a valid email address.');
    await user.clear(email);
    await user.type(email, 'member@example.com');
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'false'));
  });

  it('submits once, locks fields while pending and preserves the password payload', async () => {
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const submit = vi.fn<NonNullable<ComponentProps<typeof AuthForm>['submit']>>(() => pending);
    renderForm({ mode: 'login', submit });
    const user = await fillLogin();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      email: 'member@example.com',
      password: ' secret ',
    });
    expect(screen.getByLabelText(/^Email address/)).toBeDisabled();
    expect(screen.getByLabelText(/^Password/)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Sign in' }));
    expect(submit).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await pending;
    });
    await waitFor(() => expect(screen.getByLabelText(/^Password/)).toHaveValue(''));
  });

  it.each(['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED'])(
    'shows safe %s feedback and clears only the password',
    async (code) => {
      const error = new AuthRequestError(
        new ApiError('business', { code, status: code === 'ACCOUNT_LOCKED' ? 403 : 401 }),
        'login',
        'submit',
      );
      const submit = vi.fn().mockRejectedValue(error);
      renderForm({ mode: 'login', submit });
      const user = await fillLogin();
      await user.click(screen.getByRole('button', { name: 'Sign in' }));
      await screen.findByText(error.message);
      expect(screen.getByLabelText(/^Password/)).toHaveValue('');
      expect(screen.getByLabelText(/^Email address/)).toHaveValue('member@example.com');
      expect(submit).toHaveBeenCalledTimes(1);
    },
  );

  it('distinguishes email already registered without marking registration successful', async () => {
    const onSuccess = vi.fn();
    const error = new AuthRequestError(
      new ApiError('business', { code: 'EMAIL_ALREADY_EXISTS', status: 409 }),
      'register',
      'submit',
    );
    renderForm({ mode: 'register', submit: vi.fn().mockRejectedValue(error), onSuccess });
    const user = await fillRegistration();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('An account with this email already exists. Sign in instead.');
    expect(screen.getByLabelText(/^Full name/)).toHaveValue('Member');
    expect(screen.getByLabelText(/^Phone number/)).toHaveValue('any phone');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('blocks another registration after a submitted request times out', async () => {
    const error = new AuthRequestError(new ApiError('timeout'), 'register', 'submit');
    const submit = vi.fn().mockRejectedValue(error);
    renderForm({ mode: 'register', submit });
    const user = await fillRegistration();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByText('Registration outcome unknown');
    expect(screen.getByText(/Try signing in before creating another account/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Create account' }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('allows explicit retry when CSRF could not be fetched before submission', async () => {
    const error = new AuthRequestError(new ApiError('network'), 'login', 'csrf');
    renderForm({ mode: 'login', submit: vi.fn().mockRejectedValue(error) });
    const user = await fillLogin();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByText('The authentication request was not submitted. Please try again.');
    expect(screen.queryByText('Sign-in outcome unknown')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('provides a keyboard-operable password visibility toggle', async () => {
    renderForm({ mode: 'login', submit: vi.fn() });
    const password = screen.getByLabelText(/^Password/);
    const toggle = screen.getByRole('button', { name: /^Show$/i });
    toggle.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /^Hide$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not permit network submission without the session coordination dependency', () => {
    renderForm({ mode: 'login' });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
    expect(screen.getByText('Sign in is not available yet.')).toBeInTheDocument();
  });

  it('aborts on unmount and ignores a late completion', async () => {
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const submit = vi.fn<NonNullable<ComponentProps<typeof AuthForm>['submit']>>(() => pending);
    const onSuccess = vi.fn();
    const view = renderForm({ mode: 'login', submit, onSuccess });
    const user = await fillLogin();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const signal = submit.mock.calls[0]?.[1];
    view.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      finish();
      await pending;
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
