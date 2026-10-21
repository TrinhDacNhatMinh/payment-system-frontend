import { useEffect, useSyncExternalStore, type PropsWithChildren } from 'react';

import { AuthFormActionsContext } from './auth-form-actions';
import { SessionContext } from './session-context';
import type { SessionController } from './session-controller';

export function SessionProvider({
  controller,
  children,
}: PropsWithChildren<{ controller: SessionController }>) {
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
    <SessionContext.Provider value={{ state, controller }}>
      <AuthFormActionsContext.Provider value={state.available ? controller : null}>
        {children}
      </AuthFormActionsContext.Provider>
    </SessionContext.Provider>
  );
}
