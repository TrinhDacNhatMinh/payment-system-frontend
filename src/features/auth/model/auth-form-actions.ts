import { createContext, useContext } from 'react';

import type { LoginRequest, RegisteredUser, RegisterRequest } from '../api/auth-schemas';

export interface AuthFormActions {
  // Resolve only after the session controller has accepted the login response.
  login(request: LoginRequest, signal: AbortSignal): Promise<void>;
  register(request: RegisterRequest, signal: AbortSignal): Promise<RegisteredUser>;
}

// I1-07 supplies real session/lock/epoch coordination. No fake session or
// unlocked API fallback is created while this provider is absent.
export const AuthFormActionsContext = createContext<AuthFormActions | null>(null);

export function useAuthFormActions() {
  return useContext(AuthFormActionsContext);
}
