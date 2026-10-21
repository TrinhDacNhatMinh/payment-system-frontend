import { Alert, Button } from 'antd';

import { useAuthSession } from '../model/session-context';

export function LogoutNotice() {
  const session = useAuthSession();
  if (!session) return null;
  if (session.state.status === 'signing-out') {
    return (
      <Alert
        type="info"
        role="status"
        showIcon
        title="Signing out…"
        description="Private content is hidden while we confirm sign-out with the server."
      />
    );
  }
  if (session.state.status !== 'logout-pending') return null;
  return (
    <Alert
      type="warning"
      role="alert"
      showIcon
      title="Sign-out not confirmed"
      description={session.state.message}
      action={
        <Button
          htmlType="button"
          onClick={() => {
            void session.controller.logout();
          }}
        >
          Try again
        </Button>
      }
    />
  );
}
