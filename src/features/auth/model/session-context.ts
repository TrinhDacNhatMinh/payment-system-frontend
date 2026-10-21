import { createContext, useContext } from 'react';

import type { SessionController, SessionState } from './session-controller';
import type { PrivateApiFactory } from '../api/private-api';

export const SessionContext = createContext<{
  state: SessionState;
  controller: SessionController;
  privateApi?: PrivateApiFactory;
} | null>(null);

export function useAuthSession() {
  return useContext(SessionContext);
}
