import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { CloseOutlined, LogoutOutlined, MenuOutlined } from '@ant-design/icons';
import { useLocation } from '@tanstack/react-router';
import { Button, Drawer, Modal } from 'antd';

import { useMediaQuery } from '@/shared/lib/use-media-query';
import { Brand } from '@/shared/ui/brand';
import { AppNavigation } from './app-navigation';

type AppLayoutProps = PropsWithChildren<
  | { account?: undefined; onSignOut?: never; signingOut?: never }
  | { account: { email: string }; onSignOut?: () => void; signingOut?: boolean }
>;

// Keep this aligned with the <=700px layout breakpoint in styles.css.
const MOBILE_QUERY = '(max-width: 700px)';

export function AppLayout({ account, onSignOut, signingOut = false, children }: AppLayoutProps) {
  const mobile = useMediaQuery(MOBILE_QUERY);
  const locationKey = useLocation({ select: (location) => location.href });
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [signOutPrompt, setSignOutPrompt] = useState<{
    email: string;
    locationKey: string;
  } | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const drawerOpen = mobile && openedAt === locationKey;
  const confirmationOpen =
    signOutPrompt !== null &&
    signOutPrompt.email === account?.email &&
    signOutPrompt.locationKey === locationKey &&
    !!onSignOut &&
    !signingOut;

  useEffect(() => {
    const root = document.documentElement;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    const showScrollbar = () => {
      root.dataset.scrolling = 'true';
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        delete root.dataset.scrolling;
      }, 800);
    };
    window.addEventListener('scroll', showScrollbar, { passive: true });
    return () => {
      window.removeEventListener('scroll', showScrollbar);
      clearTimeout(hideTimer);
      delete root.dataset.scrolling;
    };
  }, []);

  if (signOutPrompt !== null && !confirmationOpen) {
    setSignOutPrompt(null);
  }

  // Discard open state on navigation or crossing to desktop; resizing back
  // must not unexpectedly reopen the modal or retain its body scroll lock.
  if (openedAt !== null && (!mobile || openedAt !== locationKey)) {
    setOpenedAt(null);
  }

  const signOutControl = account && onSignOut && (
    <Button
      htmlType="button"
      icon={<LogoutOutlined aria-hidden="true" />}
      loading={signingOut}
      onClick={() => setSignOutPrompt({ email: account.email, locationKey })}
    >
      Sign out
    </Button>
  );

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="app-header">
        <div className="flex items-center gap-3 min-w-0">
          {mobile && (
            <Button
              ref={menuTrigger}
              className="menu-trigger"
              htmlType="button"
              icon={<MenuOutlined />}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-haspopup="dialog"
              onClick={() => setOpenedAt(locationKey)}
            />
          )}
          <Brand />
        </div>
        {!mobile && account && (
          <div className="account-controls flex items-center gap-5 min-w-0">
            <span className="account-email">{account.email}</span>
            {signOutControl}
          </div>
        )}
      </header>
      <div className="app-body">
        {!mobile && (
          <aside className="app-sidebar">
            <AppNavigation />
          </aside>
        )}
        <main id="main-content" className="app-content" tabIndex={-1}>
          <div className="app-content-inner">{children}</div>
        </main>
      </div>
      <Drawer
        title="Navigation"
        closable={{ closeIcon: <CloseOutlined aria-label="Close menu" /> }}
        classNames={{ close: 'navigation-drawer-close', footer: 'navigation-drawer-footer' }}
        placement="left"
        size="min(320px, 86vw)"
        open={drawerOpen}
        keyboard={!confirmationOpen}
        mask={{ closable: true }}
        focusable={{ trap: !confirmationOpen, focusTriggerAfterClose: true }}
        destroyOnHidden
        onClose={() => setOpenedAt(null)}
        afterOpenChange={(open) => {
          if (!open && mobile) menuTrigger.current?.focus();
        }}
        footer={account ? signOutControl : undefined}
      >
        <div className="drawer-content flex flex-col gap-6">
          {account && <p className="account-email">{account.email}</p>}
          <AppNavigation onNavigate={() => setOpenedAt(null)} />
        </div>
      </Drawer>
      <Modal
        title="Sign out?"
        open={confirmationOpen}
        okText="Sign out"
        cancelText="Cancel"
        keyboard
        mask={{ closable: false }}
        focusable={{ trap: true, focusTriggerAfterClose: true }}
        destroyOnHidden
        onCancel={() => setSignOutPrompt(null)}
        onOk={() => {
          if (!confirmationOpen) return;
          setSignOutPrompt(null);
          setOpenedAt(null);
          onSignOut?.();
        }}
      >
        <p>Are you sure you want to sign out?</p>
      </Modal>
    </div>
  );
}
