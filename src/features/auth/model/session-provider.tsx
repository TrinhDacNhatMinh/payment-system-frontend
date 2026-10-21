import { useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';

import { AuthFormActionsContext } from './auth-form-actions';
import { SessionContext } from './session-context';
import type { SessionController } from './session-controller';
import type { PrivateApiFactory } from '../api/private-api';

export function SessionProvider({
  controller,
  privateApi,
  children,
}: PropsWithChildren<{ controller: SessionController; privateApi?: PrivateApiFactory }>) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);

  useEffect(() => {
    controller.start();
    const onWake = () => {
      if (document.visibilityState === 'visible') controller.checkDeadline();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      void controller.stop();
    };
  }, [controller]);

  return (
    <SessionContext.Provider value={{ state, controller, privateApi }}>
      <AuthFormActionsContext.Provider value={state.available ? controller : null}>
        {children}
      </AuthFormActionsContext.Provider>
    </SessionContext.Provider>
  );
}
