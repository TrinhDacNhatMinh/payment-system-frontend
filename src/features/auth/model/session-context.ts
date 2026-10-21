import { createContext, useContext } from 'react';

import type { SessionController, SessionState } from './session-controller';

export const SessionContext = createContext<{
  state: SessionState;
  controller: SessionController;
} | null>(null);

export function useAuthSession() {
  return useContext(SessionContext);
}
