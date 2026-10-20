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

afterEach(() => vi.unstubAllGlobals());

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
  const router = createRouter({
    routeTree: root.addChildren([wallet]),
    history: createMemoryHistory({ initialEntries: ['/wallet'] }),
  });
  await act(() => router.load());
  render(<RouterProvider router={router} />);
  return router;
}

describe('application navigation', () => {
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
    expect(within(dialog).getByRole('button', { name: /Transfer/ })).toBeDisabled();
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

  it('shows the provided account in the mobile drawer and delegates sign out', async () => {
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
    expect(onSignOut).toHaveBeenCalledOnce();
  });
});
