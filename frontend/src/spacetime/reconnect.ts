/**
 * Reconnect policy for the game websocket: exponential backoff with jitter,
 * a give-up point after which the player is offered a manual Retry, and
 * shortcuts for "the network came back" / "the tab woke up".
 *
 * Pure (timers and the connect call are injected) so it is unit-tested
 * without a server; connection.ts wires it to the real SpacetimeDB client.
 */
export interface BackoffOptions {
  /** First retry delay before jitter. */
  baseMs: number;
  /** Ceiling for the exponential part. */
  maxMs: number;
  /** Fraction (0..1) of each delay that is randomised. 0.5 -> delay in [exp/2, exp]. */
  jitter: number;
  /** Failed attempts before giving up and showing "Connection lost — Retry". */
  maxAttempts: number;
  /** An attempt with no outcome after this long counts as failed (hung handshake, lingering socket). */
  attemptTimeoutMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 15_000, jitter: 0.5, maxAttempts: 8, attemptTimeoutMs: 20_000 };

/** Delay before retry number `attempt` (0-based). */
export function backoffDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF, random: () => number = Math.random): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt));
  const jitter = Math.min(1, Math.max(0, opts.jitter));
  return Math.round(exp * (1 - jitter) + random() * exp * jitter);
}

export type ReconnectStatus =
  /** First connection of this page load. */
  | 'connecting'
  | 'connected'
  /** Lost the link; a retry is scheduled or in flight. */
  | 'reconnecting'
  /** The browser reports no network; waiting for the `online` event. */
  | 'offline'
  /** Gave up after maxAttempts; waiting for the player to press Retry. */
  | 'failed';

export interface ReconnectState {
  status: ReconnectStatus;
  /** Failed attempts since the last good connection. */
  attempt: number;
  /** Wall-clock (Date.now) time of the next automatic retry, if one is scheduled. */
  nextRetryAt: number | null;
}

export interface ReconnectDeps {
  /** Start a fresh connection attempt. The result arrives via connected()/lost(). */
  connect: () => void;
  onChange: (state: ReconnectState) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  random?: () => number;
  isOnline?: () => boolean;
}

export class ReconnectController {
  private state: ReconnectState = { status: 'connecting', attempt: 0, nextRetryAt: null };
  private timer: unknown = null;
  private watchdog: unknown = null;
  /** True between connect() and its outcome, so duplicate triggers do not stack sockets. */
  private inFlight = false;
  private readonly opts: BackoffOptions;
  private readonly deps: Required<ReconnectDeps>;

  constructor(deps: ReconnectDeps, opts: Partial<BackoffOptions> = {}) {
    this.opts = { ...DEFAULT_BACKOFF, ...opts };
    this.deps = {
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
      random: Math.random,
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      ...deps,
    };
  }

  get snapshot(): ReconnectState {
    return this.state;
  }

  /** The page's first connection attempt was opened by the caller; await its outcome. */
  start(): void {
    this.inFlight = true;
  }

  connected(): void {
    this.cancelTimer();
    this.clearWatchdog();
    this.inFlight = false;
    this.set({ status: 'connected', attempt: 0, nextRetryAt: null });
  }

  /** The socket closed, failed to open, or was declared dead by the liveness check. */
  lost(): void {
    this.clearWatchdog();
    this.inFlight = false;
    if (this.timer !== null) return; // already waiting for a retry
    if (this.state.status === 'failed') return;
    if (!this.deps.isOnline()) {
      this.set({ status: 'offline', attempt: this.state.attempt, nextRetryAt: null });
      return;
    }
    // The very first drop after a good session retries almost immediately.
    const wasConnected = this.state.status === 'connected';
    const attempt = wasConnected ? 0 : this.state.attempt;
    if (attempt >= this.opts.maxAttempts) {
      this.set({ status: 'failed', attempt, nextRetryAt: null });
      return;
    }
    const delay = backoffDelay(attempt, this.opts, this.deps.random);
    this.set({ status: 'reconnecting', attempt: attempt + 1, nextRetryAt: this.deps.now() + delay });
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      this.fire();
    }, delay);
  }

  /** Browser went offline: stop burning attempts until it is back. */
  offline(): void {
    if (this.state.status === 'connected') return; // the socket will report its own loss
    this.cancelTimer();
    if (this.state.status !== 'failed') this.set({ ...this.state, status: 'offline', nextRetryAt: null });
  }

  /** Network came back: retry now with a fresh budget. */
  online(): void {
    if (this.state.status === 'connected' || this.inFlight) return;
    this.retryNow();
  }

  /** Tab became visible / page restored from bfcache: retry now if we are waiting. */
  wake(): void {
    if (this.state.status === 'reconnecting' && !this.inFlight) {
      this.cancelTimer();
      this.fire();
    } else if (this.state.status === 'offline' && this.deps.isOnline()) {
      this.retryNow();
    }
  }

  /** The player pressed Retry (or the network returned): reset the budget and try at once. */
  retryNow(): void {
    this.cancelTimer();
    this.set({ status: 'reconnecting', attempt: 0, nextRetryAt: null });
    this.fire();
  }

  dispose(): void {
    this.cancelTimer();
    this.clearWatchdog();
  }

  private fire(): void {
    if (this.inFlight) return;
    this.inFlight = true;
    this.set({ ...this.state, nextRetryAt: null });
    this.watchdog = this.deps.setTimer(() => {
      this.watchdog = null;
      if (this.inFlight) this.lost();
    }, this.opts.attemptTimeoutMs);
    this.deps.connect();
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      this.deps.clearTimer(this.watchdog);
      this.watchdog = null;
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private set(next: ReconnectState): void {
    this.state = next;
    this.deps.onChange(next);
  }
}
