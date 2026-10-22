import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { describe, expect, it, vi } from 'vitest';

import { TransferForm } from './transfer-form';

function renderForm(
  balance = 2000,
  checkRecipient = vi.fn<(email: string, signal: AbortSignal) => Promise<boolean>>(
    async () => true,
  ),
) {
  const submit = vi.fn(async () => undefined);
  const root = createRootRoute({
    component: () => (
      <ConfigProvider theme={{ token: { motion: false } }}>
        <TransferForm balance={balance} checkRecipient={checkRecipient} submit={submit} />
      </ConfigProvider>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/transfer' })]),
    history: createMemoryHistory({ initialEntries: ['/transfer'] }),
  });
  render(<RouterProvider router={router} />);
  return { checkRecipient, submit };
}

describe('transfer field checks', () => {
  it('does not send a lookup for invalid email syntax and distinguishes a lookup outage', async () => {
    const checkRecipient = vi.fn<(email: string, signal: AbortSignal) => Promise<boolean>>(
      async () => {
        throw new Error('private server details');
      },
    );
    renderForm(2000, checkRecipient);
    const email = await screen.findByLabelText(/^Recipient email/);
    fireEvent.change(email, { target: { value: 'bad' } });
    fireEvent.blur(email);
    expect(checkRecipient).not.toHaveBeenCalled();
    fireEvent.change(email, { target: { value: 'member@example.com' } });
    fireEvent.blur(email);
    await screen.findByText('Unable to check this recipient. Please try again.');
    expect(
      screen.queryByText('No account was found with this email address.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('private server details')).not.toBeInTheDocument();
  });

  it('shows insufficient balance immediately while typing and clears it when corrected', async () => {
    const { checkRecipient } = renderForm();
    const amount = await screen.findByLabelText(/^Amount/);
    fireEvent.change(amount, { target: { value: '2001' } });
    await screen.findByText('Amount exceeds your available balance.');
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(checkRecipient).not.toHaveBeenCalled();
    fireEvent.change(amount, { target: { value: '2000' } });
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'false'));
  });

  it('checks a valid email on blur and keeps a missing recipient out of review', async () => {
    const checkRecipient = vi.fn<(email: string, signal: AbortSignal) => Promise<boolean>>(
      async () => false,
    );
    renderForm(2000, checkRecipient);
    const email = await screen.findByLabelText(/^Recipient email/);
    fireEvent.change(email, { target: { value: ' Missing@example.com ' } });
    expect(checkRecipient).not.toHaveBeenCalled();
    fireEvent.blur(email);
    await screen.findByText('No account was found with this email address.');
    expect(checkRecipient).toHaveBeenCalledWith('Missing@example.com', expect.any(AbortSignal));
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1000' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.queryByRole('heading', { name: 'Review transfer' })).not.toBeInTheDocument();
  });

  it('ignores an old response after email changes and reuses the new successful check', async () => {
    let finish: (exists: boolean) => void = () => undefined;
    let firstSignal: AbortSignal | undefined;
    const pending = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    const checkRecipient = vi.fn<(email: string, signal: AbortSignal) => Promise<boolean>>(
      async () => true,
    );
    checkRecipient.mockImplementationOnce((email, signal) => {
      expect(email).toBe('old@example.com');
      firstSignal = signal;
      return pending;
    });
    renderForm(2000, checkRecipient);
    const email = await screen.findByLabelText(/^Recipient email/);
    fireEvent.change(email, { target: { value: 'old@example.com' } });
    fireEvent.blur(email);
    fireEvent.change(email, { target: { value: 'new@example.com' } });
    expect(firstSignal?.aborted).toBe(true);
    fireEvent.blur(email);
    await waitFor(() => expect(screen.queryByText('Checking recipient…')).not.toBeInTheDocument());
    await act(async () => {
      finish(false);
    });
    expect(
      screen.queryByText('No account was found with this email address.'),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1000' } });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    await screen.findByRole('heading', { name: 'Review transfer' });
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(checkRecipient).toHaveBeenCalledTimes(2);
  });
});
