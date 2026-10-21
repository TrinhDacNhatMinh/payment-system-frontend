import { useState, type PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';

import { createTheme } from '@/shared/theme/theme';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { SessionProvider } from '@/features/auth/model/session-provider';
import { queryClient } from './query-client';
import { createAppSession } from './session';

export function AppProviders({ children }: PropsWithChildren) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [session] = useState(createAppSession);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={enUS} theme={createTheme(reducedMotion)}>
        <App>
          <SessionProvider controller={session.controller} privateApi={session.privateApi}>
            {children}
          </SessionProvider>
        </App>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
