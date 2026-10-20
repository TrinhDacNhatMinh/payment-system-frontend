import '@tanstack/react-router';

declare module '@tanstack/react-router' {
  interface HistoryState {
    authReturnTo?: unknown;
  }
}

// Only the private route implemented in iteration 1 is a valid return target.
// Do not forward arbitrary URLs, query values or business drafts to history.
export function getAuthReturnTo(value: unknown): '/wallet' | undefined {
  return value === '/wallet' ? value : undefined;
}
