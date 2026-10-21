import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { AppProviders } from '@/app/providers';
import { AppRouter } from '@/app/app-router';
import '@/shared/config/env';
import { applyThemeVariables } from '@/shared/theme/theme';
import '@/shared/theme/styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing application root element.');
}

applyThemeVariables(document.documentElement);

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AppRouter />
    </AppProviders>
  </StrictMode>,
);
