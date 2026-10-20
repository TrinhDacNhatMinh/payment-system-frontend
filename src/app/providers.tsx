import type { PropsWithChildren } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';

import { createTheme } from '@/shared/theme/theme';
import { useMediaQuery } from '@/shared/lib/use-media-query';
import { queryClient } from './query-client';

export function AppProviders({ children }: PropsWithChildren) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={enUS} theme={createTheme(reducedMotion)}>
        <App>{children}</App>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
