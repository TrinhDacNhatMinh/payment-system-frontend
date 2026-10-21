import '@tanstack/react-router';

declare module '@tanstack/react-router' {
  interface HistoryState {
    authReturnTo?: unknown;
  }
}

// Only implemented private routes are valid return targets.
// Do not forward arbitrary URLs, query values or business drafts to history.
export function getAuthReturnTo(value: unknown): '/wallet' | '/transfer' | undefined {
  return value === '/wallet' || value === '/transfer' ? value : undefined;
}
