import type { PropsWithChildren } from 'react';

import { AuthFormActionsContext, type AuthFormActions } from './auth-form-actions';

export function AuthFormActionsProvider({
  actions,
  children,
}: PropsWithChildren<{ actions: AuthFormActions }>) {
  return (
    <AuthFormActionsContext.Provider value={actions}>{children}</AuthFormActionsContext.Provider>
  );
}
