import type { ErrorComponentProps } from '@tanstack/react-router';

import { SessionAccessError } from '@/features/auth/model/session-access';
import { useAuthSession } from '@/features/auth/model/session-context';
import { ContentState } from '@/shared/ui/content-state';
import { RouteErrorPage } from '@/shared/ui/route-error-page';
import { AppLayout } from './app-layout';
import { SignedOutPage } from './signed-out-page';

export function ProtectedRouteError({ error }: ErrorComponentProps) {
  const session = useAuthSession();
  if (
    error instanceof SessionAccessError &&
    error.denied &&
    session?.controller.getAccessIdentity()
  ) {
    return (
      <AppLayout>
        <ContentState
          kind="error"
          title="Access denied"
          description="You do not have permission to view this page."
        />
      </AppLayout>
    );
  }
  if (error instanceof SessionAccessError || !session?.controller.getAccessIdentity())
    return <SignedOutPage />;
  return <RouteErrorPage />;
}
