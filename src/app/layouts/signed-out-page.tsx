import { SignInPage } from '@/features/auth/pages/sign-in-page';
import { useAuthSession } from '@/features/auth/model/session-context';
import { LogoutNotice } from '@/features/auth/ui/logout-notice';
import { ContentState } from '@/shared/ui/content-state';
import { AppLayout } from './app-layout';

export function SignedOutPage() {
  const session = useAuthSession();
  const state = session?.state;
  if (state?.status === 'signing-out') {
    return (
      <AppLayout>
        <LogoutNotice />
      </AppLayout>
    );
  }
  if (state?.status === 'restoring') {
    return (
      <AppLayout>
        <ContentState
          kind="loading"
          title="Restoring your session…"
          description="Please wait while we check your session."
        />
      </AppLayout>
    );
  }
  if (state?.status === 'authenticated') {
    return (
      <AppLayout>
        <ContentState
          kind="loading"
          title="Loading your page…"
          description="Please wait while we verify access to this page."
        />
      </AppLayout>
    );
  }
  return (
    <AppLayout>
      {state?.status === 'connection-error' && (
        <ContentState
          kind="error"
          title="Unable to check your session"
          description={state.message}
          onRetry={() => {
            void session?.controller.restore();
          }}
        />
      )}
      {state?.status === 'unsupported' && (
        <ContentState kind="warning" title="Session unavailable" description={state.message} />
      )}
      {state?.status === 'locked' && (
        <ContentState kind="error" title="Account unavailable" description={state.message} />
      )}
      {state?.status === 'logout-pending' && <LogoutNotice />}
      {state?.status === 'refresh-uncertain' && (
        <ContentState kind="warning" title="Sign in again" description={state.message} />
      )}
      <SignInPage embedded />
    </AppLayout>
  );
}
