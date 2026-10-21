import { Alert } from 'antd';

import { useAuthSession } from '../model/session-context';
import { LogoutNotice } from './logout-notice';

export function SessionNotice() {
  const session = useAuthSession();
  if (!session) return null;
  const { state } = session;
  if (state.status === 'signing-out' || state.status === 'logout-pending') return <LogoutNotice />;
  if (state.status === 'restoring')
    return <Alert type="info" role="status" showIcon title="Restoring your session…" />;
  if (
    state.status === 'unsupported' ||
    state.status === 'connection-error' ||
    state.status === 'locked'
  ) {
    return <Alert type="error" role="alert" showIcon title={state.message} />;
  }
  if (state.status === 'refresh-uncertain') {
    return <Alert type="warning" role="status" showIcon title={state.message} />;
  }
  return null;
}
