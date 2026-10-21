import type { PropsWithChildren } from 'react';
import { useRouterState } from '@tanstack/react-router';

import { sameAccess, type SessionAccess } from '@/features/auth/model/session-access';
import { useAuthSession } from '@/features/auth/model/session-context';
import { ContentState } from '@/shared/ui/content-state';
import { AppLayout } from './app-layout';
import { SignedOutPage } from './signed-out-page';

export function PrivateContent({ access, children }: PropsWithChildren<{ access: SessionAccess }>) {
  const session = useAuthSession();
  const pending = useRouterState({ select: (state) => state.status === 'pending' });
  if (!session || !sameAccess(session.controller.getAccessIdentity(), access))
    return <SignedOutPage />;
  return (
    <AppLayout account={{ email: access.user.email }}>
      {pending ? (
        <ContentState kind="loading" title="Loading your page…" />
      ) : (
        <div key={`${access.epoch}:${access.user.id}:${access.user.role}`}>{children}</div>
      )}
    </AppLayout>
  );
}
