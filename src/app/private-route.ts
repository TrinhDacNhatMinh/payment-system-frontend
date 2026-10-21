import {
  requireSessionAccess,
  SessionAccessError,
  type SessionRole,
} from '@/features/auth/model/session-access';
import type { AppRouterContext } from './router-context';

export async function privateRouteContext(
  context: Pick<AppRouterContext, 'session' | 'privateApi'>,
  options: { signal?: AbortSignal; preload?: boolean; roles?: readonly SessionRole[] } = {},
) {
  const access = await requireSessionAccess(context.session, options);
  if (!context.privateApi) throw new SessionAccessError();
  return { access, api: context.privateApi(access) };
}
