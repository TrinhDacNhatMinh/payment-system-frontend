import { useSyncExternalStore, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';

import { createTheme } from '@/shared/theme/theme';
import { queryClient } from './query-client';

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

function subscribeToMotionPreference(callback: () => void) {
  motionPreference.addEventListener('change', callback);
  return () => motionPreference.removeEventListener('change', callback);
}

export function AppProviders({ children }: PropsWithChildren) {
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    () => motionPreference.matches,
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={enUS} theme={createTheme(reducedMotion)}>
        <App>{children}</App>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
