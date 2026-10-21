import { z } from 'zod';

export const AUTH_CONTROL_KEY = 'payment-system.auth-control.v1';
export const AUTH_CHANNEL_NAME = 'payment-system.auth-events';
export const AUTH_LOCK_NAME = 'payment-system.auth';
export const AUTH_CONTROL_LOCK_NAME = 'payment-system.auth-control';

export const authControlSchema = z
  .object({
    version: z.literal(1),
    epoch: z.string().uuid(),
    mode: z.enum([
      'active',
      'logout-pending',
      'signed-out',
      'reauth-required',
      'refresh-uncertain',
    ]),
  })
  .strict();

export type AuthControl = z.infer<typeof authControlSchema>;
export type ControlRead = AuthControl | null | 'invalid';

export interface SessionCoordination {
  read(): ControlRead;
  change(update: (current: ControlRead) => AuthControl | null): Promise<AuthControl | null>;
  runExclusive<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T>;
  subscribe(listener: () => void): () => void;
  newEpoch(): string;
}

export class CoordinationUnavailableError extends Error {
  constructor() {
    super(
      'Session coordination is unavailable. Allow browser storage and use a supported browser on HTTPS or localhost.',
    );
    this.name = 'CoordinationUnavailableError';
  }
}

export function isControl(value: ControlRead): value is AuthControl {
  return value !== null && value !== 'invalid';
}

export function parseAuthControl(raw: string | null): ControlRead {
  if (raw === null) return null;
  try {
    const result = authControlSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : 'invalid';
  } catch {
    return 'invalid';
  }
}
