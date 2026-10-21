import { ApiError, normalizeApiError } from '@/shared/api/api-error';
import type { ApiTransport } from '@/shared/api/http-client';
import { AuthRequestError, createAuthApi } from '../api/auth-api';
import type { AuthSession, LoginRequest, RegisterRequest } from '../api/auth-schemas';
import {
  CoordinationUnavailableError,
  isControl,
  type AuthControl,
  type ControlRead,
  type SessionCoordination,
} from './session-control';

type SignedOutStatus =
  | 'anonymous'
  | 'reauth-required'
  | 'locked'
  | 'logout-pending'
  | 'refresh-uncertain'
  | 'connection-error'
  | 'unsupported';
export type SessionState = { available: boolean } & (
  | { status: 'restoring' | 'signing-in'; epoch: string | null }
  | { status: 'authenticated'; epoch: string; user: AuthSession['user']; expiresAt: number }
  | { status: SignedOutStatus; epoch: string | null; message: string }
);

type Job = {
  abort: AbortController;
  generation: number;
  epoch: string | null;
  submitted: boolean;
  kind: 'login' | 'register' | 'refresh';
  previousUserId: number | null;
  previousRole: AuthSession['user']['role'] | null;
};

type SessionDependencies = {
  transport: ApiTransport;
  coordination: SessionCoordination;
  clearPrivateData: () => void;
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

class SupersededSessionError extends ApiError {
  constructor() {
    super('cancelled');
    this.name = 'SupersededSessionError';
  }
}

export function createSessionController(dependencies: SessionDependencies) {
  const { coordination, clearPrivateData } = dependencies;
  const now = dependencies.now ?? Date.now;
  const setTimer = dependencies.setTimer ?? ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = dependencies.clearTimer ?? clearTimeout;
  const listeners = new Set<() => void>();
  const jobs = new Set<Job>();
  let state: SessionState = { status: 'restoring', epoch: null, available: false };
  let token: string | null = null;
  let refreshAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshFlight: Promise<void> | null = null;
  let stopBarrier: Promise<void> | null = null;
  let cleanupFailed = false;
  let running = false;
  let generation = 0;
  let observed: ControlRead = null;
  let hasObservedControl = false;
  let unsubscribe: (() => void) | null = null;

  function emit(next: SessionState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function stopTimer() {
    if (timer !== null) clearTimer(timer);
    if (expiryTimer !== null) clearTimer(expiryTimer);
    timer = null;
    expiryTimer = null;
  }

  function clearMemory(abortJobs = false) {
    stopTimer();
    token = null;
    refreshAt = 0;
    clearPrivateData();
    if (abortJobs)
      for (const job of jobs) {
        // An explicit login whose intent is still waiting for the control lock
        // must not be cancelled by the older epoch it is about to replace.
        if (job.kind !== 'login' || job.epoch !== null) job.abort.abort();
      }
  }

  function unsupported() {
    clearMemory(true);
    emit({
      status: 'unsupported',
      epoch: null,
      available: false,
      message: new CoordinationUnavailableError().message,
    });
  }

  function adoptBlocked(control: ControlRead) {
    observed = control;
    hasObservedControl = true;
    clearMemory(true);
    const mode = isControl(control) ? control.mode : 'reauth-required';
    emit({
      status: mode === 'signed-out' ? 'anonymous' : mode === 'active' ? 'reauth-required' : mode,
      epoch: isControl(control) ? control.epoch : null,
      available: true,
      message:
        mode === 'logout-pending'
          ? 'Sign-out has not been confirmed by the server. Sign in to complete session cleanup.'
          : mode === 'refresh-uncertain'
            ? 'Your session could not be confirmed. Please sign in again.'
            : 'Please sign in to continue.',
    });
  }

  function current(job: Job, mode?: AuthControl['mode']) {
    if (!running || job.generation !== generation || job.abort.signal.aborted) return false;
    const marker = coordination.read();
    return isControl(marker) && marker.epoch === job.epoch && (!mode || marker.mode === mode);
  }

  async function block(
    job: Job,
    mode: AuthControl['mode'],
    status: SignedOutStatus,
    message: string,
    stillApplies: () => boolean = () => true,
  ) {
    if (!current(job) || !stillApplies()) return;
    const next = await coordination.change((control) =>
      running &&
      job.generation === generation &&
      !job.abort.signal.aborted &&
      isControl(control) &&
      control.epoch === job.epoch &&
      stillApplies()
        ? { version: 1, epoch: coordination.newEpoch(), mode }
        : null,
    );
    if (!next || !running || job.generation !== generation) return;
    const latest = coordination.read();
    if (!isControl(latest) || latest.epoch !== next.epoch) return;
    observed = next;
    clearMemory(true);
    emit({ status, epoch: next.epoch, available: true, message });
  }

  function planRefresh() {
    stopTimer();
    if (!running || state.status !== 'authenticated') return;
    timer = setTimer(
      () => {
        timer = null;
        checkDeadline();
      },
      Math.min(Math.max(0, refreshAt - now()), 2_147_483_647),
    );
    const epoch = state.epoch;
    const expiresAt = state.expiresAt;
    expiryTimer = setTimer(
      () => {
        expiryTimer = null;
        if (!running || state.status !== 'authenticated' || state.epoch !== epoch) return;
        if (now() < expiresAt) {
          planRefresh();
          return;
        }
        clearMemory();
        emit({ status: 'restoring', epoch, available: true });
        void restore();
      },
      Math.min(Math.max(0, expiresAt - now()), 2_147_483_647),
    );
  }

  function isCurrentEpoch(epoch: string) {
    if (!running || state.epoch !== epoch) return false;
    try {
      const control = coordination.read();
      return isControl(control) && control.mode === 'active' && control.epoch === epoch;
    } catch {
      return false;
    }
  }

  function getAccessIdentity() {
    if (!running || !token || state.status !== 'authenticated' || now() >= state.expiresAt)
      return null;
    return isCurrentEpoch(state.epoch) ? { epoch: state.epoch, user: state.user } : null;
  }

  function getAccessToken() {
    if (!running || state.status !== 'authenticated' || now() >= state.expiresAt) return null;
    try {
      const control = coordination.read();
      return isControl(control) && control.epoch === state.epoch && control.mode === 'active'
        ? token
        : null;
    } catch {
      unsupported();
      return null;
    }
  }

  function onControlChange() {
    if (!running) return;
    try {
      const latest = coordination.read();
      if (
        isControl(latest) &&
        isControl(observed) &&
        latest.epoch === observed.epoch &&
        latest.mode === observed.mode
      )
        return;
      if (!isControl(latest) || latest.mode !== 'active') {
        adoptBlocked(latest);
        return;
      }
      observed = latest;
      hasObservedControl = true;
      clearMemory(true);
      refreshFlight = null;
      emit({ status: 'restoring', epoch: latest.epoch, available: true });
      void restore();
    } catch {
      unsupported();
    }
  }

  function newJob(kind: Job['kind'], signal?: AbortSignal) {
    const job: Job = {
      kind,
      abort: new AbortController(),
      generation,
      epoch: null,
      submitted: false,
      previousUserId: state.status === 'authenticated' ? state.user.id : null,
      previousRole: state.status === 'authenticated' ? state.user.role : null,
    };
    const onAbort = () => job.abort.abort();
    if (signal?.aborted) job.abort.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    jobs.add(job);
    return {
      job,
      release: () => {
        jobs.delete(job);
        signal?.removeEventListener('abort', onAbort);
      },
    };
  }

  async function underAuthLock<T>(
    job: Job,
    action: (api: ReturnType<typeof createAuthApi>) => Promise<T>,
  ) {
    return coordination.runExclusive(async () => {
      if (!running || job.generation !== generation) throw new SupersededSessionError();
      let held = true;
      const transport: ApiTransport = {
        request(options, schema) {
          job.abort.signal.throwIfAborted();
          if (options.method === 'POST' && job.kind !== 'register' && !current(job)) {
            throw new SupersededSessionError();
          }
          if (options.method === 'POST') job.submitted = true;
          return dependencies.transport.request(options, schema);
        },
      };
      // This runner is valid only inside the acquired real auth lock. It never
      // reacquires that lock, including cleanup logout followed by login.
      const api = createAuthApi(transport, async (operation) => {
        if (!held) throw new SupersededSessionError();
        return operation();
      });
      try {
        return await action(api);
      } finally {
        held = false;
      }
    }, job.abort.signal);
  }

  async function accept(session: AuthSession, startedAt: number, job: Job) {
    if (!current(job)) throw new SupersededSessionError();
    const ttl = session.expiresIn * 1000;
    const expiresAt = startedAt + ttl;
    const deadline = expiresAt - Math.min(60_000, ttl * 0.1);
    if (!Number.isSafeInteger(expiresAt) || now() >= deadline) {
      await block(
        job,
        job.kind === 'refresh' ? 'refresh-uncertain' : 'reauth-required',
        job.kind === 'refresh' ? 'refresh-uncertain' : 'reauth-required',
        'The session response arrived too late. Please sign in again.',
      );
      throw new ApiError('protocol');
    }
    const userChanged =
      job.previousUserId !== null &&
      (job.previousUserId !== session.user.id || job.previousRole !== session.user.role);
    const next = await coordination.change((control) =>
      running &&
      job.generation === generation &&
      !job.abort.signal.aborted &&
      isControl(control) &&
      control.epoch === job.epoch
        ? {
            ...control,
            mode: 'active',
            epoch: userChanged ? coordination.newEpoch() : control.epoch,
          }
        : null,
    );
    if (!next || !running || job.generation !== generation || job.abort.signal.aborted)
      throw new SupersededSessionError();
    job.epoch = next.epoch;
    if (!current(job, 'active')) throw new SupersededSessionError();
    if (job.kind === 'login' || userChanged) clearMemory();
    observed = next;
    token = session.accessToken;
    refreshAt = deadline;
    emit({
      status: 'authenticated',
      epoch: next.epoch,
      user: session.user,
      expiresAt,
      available: true,
    });
    planRefresh();
  }

  async function handleRefreshFailure(error: unknown, job: Job) {
    if (!current(job)) return;
    const failure = normalizeApiError(error);
    if (failure.status === 401 && failure.code === 'REFRESH_TOKEN_MISSING') {
      await block(job, 'signed-out', 'anonymous', 'Please sign in to continue.');
    } else if (failure.status === 403 && failure.code === 'ACCOUNT_LOCKED') {
      await block(job, 'reauth-required', 'locked', failure.message);
    } else if (
      failure.status === 401 &&
      ['REFRESH_TOKEN_EXPIRED', 'REFRESH_TOKEN_REVOKED', 'REFRESH_TOKEN_NOT_FOUND'].includes(
        failure.code ?? '',
      )
    ) {
      await block(job, 'reauth-required', 'reauth-required', failure.message);
    } else {
      const beforePost = error instanceof AuthRequestError && error.phase !== 'submit';
      const safeRejection =
        failure.kind === 'business' &&
        ((failure.status === 409 && failure.code === 'AUTH_SESSION_BUSY') ||
          (failure.status === 403 &&
            ['CSRF_TOKEN_MISSING', 'CSRF_TOKEN_INVALID', 'ORIGIN_NOT_ALLOWED'].includes(
              failure.code ?? '',
            )));
      if (!job.submitted || beforePost || safeRejection) {
        clearMemory();
        emit({
          status: 'connection-error',
          epoch: job.epoch,
          available: true,
          message: failure.message,
        });
      } else {
        await block(
          job,
          'refresh-uncertain',
          'refresh-uncertain',
          'Your session could not be confirmed. Please sign in again.',
        );
      }
    }
  }

  async function restoreUnderLock(
    job: Job,
    action: (api: ReturnType<typeof createAuthApi>) => Promise<void>,
  ) {
    // Cleanup may still be publishing the blocking marker when React remounts.
    // Wait only for that short control operation, never for the old HTTP response.
    if (stopBarrier) await stopBarrier;
    if (cleanupFailed) throw new CoordinationUnavailableError();
    if (
      !running ||
      job.generation !== generation ||
      job.abort.signal.aborted ||
      state.status === 'signing-in'
    )
      return;
    const control = coordination.read();
    if (
      control === 'invalid' ||
      (control === null && hasObservedControl) ||
      (isControl(control) && control.mode !== 'active')
    ) {
      adoptBlocked(control);
      return;
    }
    // Recheck inside the auth lock as well: another tab can change the marker
    // after this early check. Blocked sessions must not wait on an old request.
    return underAuthLock(job, action);
  }

  function restore(rejectedAccessToken?: string): Promise<void> {
    if (!running || !state.available || state.status === 'signing-in') return Promise.resolve();
    if (refreshFlight) return refreshFlight;
    const { job, release } = newJob('refresh');
    const work = restoreUnderLock(job, async (api) => {
      try {
        let control = coordination.read();
        if (control === null && !hasObservedControl) {
          control = await coordination.change((latest) =>
            latest === null
              ? { version: 1, epoch: coordination.newEpoch(), mode: 'active' }
              : isControl(latest)
                ? latest
                : null,
          );
        }
        if (!isControl(control) || control.mode !== 'active') {
          adoptBlocked(control);
          return;
        }
        hasObservedControl = true;
        if (isControl(observed) && observed.epoch !== control.epoch) clearMemory();
        observed = control;
        job.epoch = control.epoch;
        if (!current(job, 'active')) return;
        const currentToken = getAccessToken();
        if (currentToken && currentToken !== rejectedAccessToken && now() < refreshAt) return;
        if (state.status !== 'authenticated' || now() >= state.expiresAt) {
          clearMemory();
          emit({ status: 'restoring', epoch: control.epoch, available: true });
        }
        const startedAt = now();
        const result = await api.refresh(job.abort.signal);
        job.submitted = false;
        await accept(result, startedAt, job);
      } catch (error) {
        if (error instanceof CoordinationUnavailableError) throw error;
        await handleRefreshFailure(error, job);
      }
    })
      .catch((error: unknown) => {
        if (running && job.generation === generation && !job.abort.signal.aborted) {
          if (error instanceof CoordinationUnavailableError || job.epoch === null) unsupported();
          else {
            clearMemory();
            emit({
              status: 'connection-error',
              epoch: job.epoch,
              available: true,
              message: 'Your session could not be checked. Please try again.',
            });
          }
        }
      })
      .finally(() => {
        release();
        if (refreshFlight === work) refreshFlight = null;
      });
    refreshFlight = work;
    return work;
  }

  function checkDeadline() {
    if (!running || state.status !== 'authenticated') return;
    if (now() >= refreshAt || !getAccessToken()) void restore();
    else planRefresh();
  }

  async function login(values: LoginRequest, signal: AbortSignal) {
    if (!running || !state.available) throw new ApiError('client');
    if (signal.aborted) throw new ApiError('cancelled');
    const { job, release } = newJob('login', signal);
    try {
      // Intent is published before waiting for the network/auth lock. The short
      // control lock never waits for that network lock, avoiding lock inversion.
      let cleanupRequired = false;
      const intent = await coordination.change((control) => {
        if (!running || job.generation !== generation || job.abort.signal.aborted) return null;
        cleanupRequired =
          control === 'invalid' ||
          (isControl(control) &&
            (control.mode === 'logout-pending' || control.mode === 'refresh-uncertain'));
        return {
          version: 1,
          epoch: coordination.newEpoch(),
          mode: cleanupRequired ? 'logout-pending' : 'reauth-required',
        };
      });
      const latestIntent = coordination.read();
      if (
        !intent ||
        !running ||
        job.generation !== generation ||
        !isControl(latestIntent) ||
        latestIntent.epoch !== intent.epoch
      ) {
        throw new SupersededSessionError();
      }
      job.epoch = intent.epoch;
      for (const other of jobs)
        if (other !== job && (other.kind !== 'login' || other.epoch !== null)) other.abort.abort();
      refreshFlight = null;
      observed = intent;
      hasObservedControl = true;
      clearMemory();
      emit({ status: 'signing-in', epoch: intent.epoch, available: true });
      await underAuthLock(job, async (api) => {
        if (!current(job)) throw new SupersededSessionError();
        if (cleanupRequired) {
          try {
            await api.logout(job.abort.signal);
          } catch (error) {
            if (current(job)) {
              emit({
                status: 'logout-pending',
                epoch: job.epoch,
                available: true,
                message: 'Session cleanup was not confirmed. Sign in again to retry cleanup.',
              });
            }
            throw error;
          }
          if (!current(job)) throw new SupersededSessionError();
          await coordination.change((control) =>
            isControl(control) && control.epoch === job.epoch
              ? { ...control, mode: 'reauth-required' }
              : null,
          );
        }
        if (!current(job)) throw new SupersededSessionError();
        const startedAt = now();
        try {
          await accept(await api.login(values, job.abort.signal), startedAt, job);
        } catch (error) {
          if (current(job) && state.status !== 'authenticated') {
            const failure = normalizeApiError(error);
            clearMemory();
            emit({
              status: failure.code === 'ACCOUNT_LOCKED' ? 'locked' : 'reauth-required',
              epoch: job.epoch,
              available: true,
              message: failure.message,
            });
          }
          throw error;
        }
      });
    } catch (error) {
      if (error instanceof CoordinationUnavailableError) unsupported();
      else if (running && job.generation === generation) {
        try {
          const control = coordination.read();
          if (
            isControl(control) &&
            control.epoch === job.epoch &&
            control.mode !== 'active' &&
            state.status === 'signing-in'
          ) {
            emit({
              status: control.mode === 'logout-pending' ? 'logout-pending' : 'reauth-required',
              epoch: control.epoch,
              available: true,
              message: 'Sign-in was not completed. Please review your sign-in.',
            });
          }
        } catch {
          unsupported();
        }
      }
      throw normalizeApiError(error);
    } finally {
      release();
    }
  }

  async function register(values: RegisterRequest, signal: AbortSignal) {
    if (!running || !state.available) throw new ApiError('client');
    if (signal.aborted) throw new ApiError('cancelled');
    const { job, release } = newJob('register', signal);
    try {
      return await underAuthLock(job, async (api) => {
        const control = coordination.read();
        job.epoch = isControl(control) ? control.epoch : null;
        const result = await api.register(values, job.abort.signal);
        const latest = coordination.read();
        if (
          !running ||
          job.generation !== generation ||
          job.abort.signal.aborted ||
          (isControl(latest) ? latest.epoch : null) !== job.epoch
        )
          throw new SupersededSessionError();
        return result;
      });
    } catch (error) {
      if (error instanceof CoordinationUnavailableError) unsupported();
      throw normalizeApiError(error);
    } finally {
      release();
    }
  }

  function start() {
    if (running) return;
    running = true;
    generation += 1;
    try {
      if (cleanupFailed) throw new CoordinationUnavailableError();
      unsubscribe = coordination.subscribe(onControlChange);
      const control = coordination.read();
      if (
        control === 'invalid' ||
        (control === null && hasObservedControl) ||
        (isControl(control) && control.mode !== 'active')
      ) {
        adoptBlocked(control);
      } else {
        observed = control;
        emit({
          status: 'restoring',
          epoch: isControl(control) ? control.epoch : null,
          available: true,
        });
        void restore();
      }
    } catch {
      unsupported();
    }
  }

  async function stop() {
    if (!running) return;
    running = false;
    generation += 1;
    const releaseSubscription = unsubscribe;
    unsubscribe = null;
    stopTimer();
    // A submitted refresh can commit despite browser abort. Block bootstrap
    // before a StrictMode remount or later mount can reuse that uncertain cookie.
    const submitted = [...jobs].find((job) => job.kind === 'refresh' && job.submitted);
    const blocking = submitted
      ? coordination.change((control) =>
          isControl(control) && control.epoch === submitted.epoch
            ? { version: 1, epoch: coordination.newEpoch(), mode: 'refresh-uncertain' }
            : null,
        )
      : Promise.resolve(null);
    for (const job of jobs) job.abort.abort();
    refreshFlight = null;
    clearMemory();
    const settled = blocking
      .then(() => undefined)
      .catch(() => {
        // A remounted controller must not bootstrap if publishing failed.
        cleanupFailed = true;
        if (running) unsupported();
      })
      .finally(() => {
        releaseSubscription?.();
        if (stopBarrier === settled) stopBarrier = null;
      });
    stopBarrier = settled;
    await settled;
  }

  return {
    start,
    stop,
    restore,
    checkDeadline,
    getAccessToken,
    getAccessIdentity,
    isCurrentEpoch,
    login,
    register,
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async ensureAccessToken() {
      if (!getAccessToken() || now() >= refreshAt) await restore();
      const value = getAccessToken();
      if (!value) throw new ApiError('business', { code: 'UNAUTHORIZED' });
      return value;
    },
    async renewAccessToken(rejectedAccessToken: string) {
      await restore(rejectedAccessToken);
      const value = getAccessToken();
      if (!value) throw new ApiError('business', { code: 'UNAUTHORIZED' });
      return value;
    },
    async rejectAccess(epoch: string, rejectedAccessToken: string, locked = false) {
      if (getAccessToken() !== rejectedAccessToken || getAccessIdentity()?.epoch !== epoch) return;
      const { job, release } = newJob('refresh');
      job.epoch = epoch;
      try {
        await block(
          job,
          'reauth-required',
          locked ? 'locked' : 'reauth-required',
          locked ? 'Your account is locked.' : 'Please sign in again to continue.',
          () => token === rejectedAccessToken,
        );
      } finally {
        release();
      }
    },
  };
}

export type SessionController = ReturnType<typeof createSessionController>;
