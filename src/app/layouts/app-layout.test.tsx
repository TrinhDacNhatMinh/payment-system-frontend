import type { ReactNode } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { ConfigProvider } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTheme } from '@/shared/theme/theme';
import { AppLayout } from './app-layout';
import { SignedOutPage } from './signed-out-page';

let viewportWidth = 390;
let mediaQueries: Map<string, MediaQueryList>;

beforeEach(() => {
  // rc-util returns the same ID for every dialog in test mode. Development
  // mode uses React IDs, preserving accessible names for drawer + modal.
  vi.stubEnv('NODE_ENV', 'development');
  viewportWidth = 390;
  mediaQueries = new Map();
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => {
      const existing = mediaQueries.get(query);
      if (existing) return existing;
      const events = new EventTarget();
      const media = {
        get matches() {
          const maxWidth = /max-width:\s*(\d+)px/.exec(query);
          return maxWidth ? viewportWidth <= Number(maxWidth[1]) : false;
        },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
      } as MediaQueryList;
      mediaQueries.set(query, media);
      return media;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function resizeViewport(width: number) {
  act(() => {
    viewportWidth = width;
    for (const media of mediaQueries.values()) media.dispatchEvent(new Event('change'));
  });
}

async function renderLayout(component: () => ReactNode) {
  const root = createRootRoute({
    component: () => <ConfigProvider theme={createTheme(true)}>{component()}</ConfigProvider>,
  });
  const wallet = createRoute({ getParentRoute: () => root, path: '/wallet' });
  const transfer = createRoute({ getParentRoute: () => root, path: '/transfer' });
  const router = createRouter({
    routeTree: root.addChildren([wallet, transfer]),
    history: createMemoryHistory({ initialEntries: ['/wallet'] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  return router;
}

describe('application navigation', () => {
  it.each([390, 1200])('navigates to Transfer and marks it active at %spx', async (width) => {
    viewportWidth = width;
    const user = userEvent.setup();
    const router = await renderLayout(() => (
      <AppLayout>
        <h1>Page content</h1>
      </AppLayout>
    ));
    if (width <= 700) await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const transfer = await screen.findByRole('link', { name: 'Transfer' });
    expect(transfer).toHaveAttribute('href', '/transfer');
    await user.hover(transfer);
    expect(router.state.location.pathname).toBe('/wallet');
    await user.click(transfer);
    await waitFor(() => expect(router.state.location.pathname).toBe('/transfer'));
    if (width <= 700) {
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: 'Open menu' }));
    }
    expect(await screen.findByRole('link', { name: 'Transfer' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Wallet' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('closes the mobile drawer with Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    await renderLayout(() => (
      <AppLayout>
        <h1>Page content</h1>
      </AppLayout>
    ));
    const trigger = await screen.findByRole('button', { name: 'Open menu' });
    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Navigation' });
    expect(within(dialog).getByRole('link', { name: /Wallet/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(dialog).getByRole('link', { name: 'Transfer' })).toHaveAttribute(
      'href',
      '/transfer',
    );
    for (const name of [/Top up/, /Transactions/]) {
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
      expect(within(dialog).queryByRole('link', { name })).not.toBeInTheDocument();
    }
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not reopen a mobile drawer after crossing the desktop breakpoint', async () => {
    const user = userEvent.setup();
    await renderLayout(() => (
      <AppLayout>
        <h1>Page content</h1>
      </AppLayout>
    ));
    await user.click(await screen.findByRole('button', { name: 'Open menu' }));
    await screen.findByRole('dialog');
    resizeViewport(701);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
    resizeViewport(700);
    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a signed-out wallet URL without exposing an account or sign-out action', async () => {
    const router = await renderLayout(SignedOutPage);
    await screen.findByRole('heading', { name: 'Sign in' });
    expect(router.state.location.pathname).toBe('/wallet');
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByText('Available balance')).not.toBeInTheDocument();
  });

  it('shows the mobile account and delegates sign out only after confirmation', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    await renderLayout(() => (
      <AppLayout account={{ email: 'member@example.com' }} onSignOut={onSignOut}>
        <h1>Page content</h1>
      </AppLayout>
    ));
    expect(screen.queryByText('member@example.com')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Open menu' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('member@example.com')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Sign out' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Sign out?' });
    expect(onSignOut).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('cancels mobile sign out with Escape while keeping the account menu open', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    await renderLayout(() => (
      <AppLayout account={{ email: 'member@example.com' }} onSignOut={onSignOut}>
        <h1>Page content</h1>
      </AppLayout>
    ));
    await user.click(await screen.findByRole('button', { name: 'Open menu' }));
    const menu = await screen.findByRole('dialog', { name: 'Navigation' });
    const trigger = within(menu).getByRole('button', { name: 'Sign out' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sign out?' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('dialog', { name: 'Navigation' })).toBeInTheDocument();
    expect(onSignOut).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps desktop content after Cancel and allows confirming a later sign out', async () => {
    viewportWidth = 1200;
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    await renderLayout(() => (
      <AppLayout account={{ email: 'member@example.com' }} onSignOut={onSignOut}>
        <h1>Page content</h1>
      </AppLayout>
    ));
    const trigger = await screen.findByRole('button', { name: 'Sign out' });
    await user.click(trigger);
    let confirmation = await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Sign out?' })).not.toBeInTheDocument(),
    );
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Page content' })).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    confirmation = await screen.findByRole('dialog', { name: 'Sign out?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
