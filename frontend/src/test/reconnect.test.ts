import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, DEFAULT_BACKOFF, ReconnectController, type ReconnectState } from '../spacetime/reconnect';
import { abortPendingCalls, ConnectionLostError, pendingCallCount, trackCall } from '../spacetime/pendingCalls';

describe('backoffDelay', () => {
  const opts = { baseMs: 500, maxMs: 8000, jitter: 0.5, maxAttempts: 5 };
  it('grows exponentially and caps at maxMs (no jitter at random=1)', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map((a) => backoffDelay(a, opts, () => 1))).toEqual([500, 1000, 2000, 4000, 8000, 8000, 8000]);
  });
  it('jitter keeps each delay within [exp*(1-jitter), exp]', () => {
    expect(backoffDelay(3, opts, () => 0)).toBe(2000);
    for (let i = 0; i < 200; i++) {
      const d = backoffDelay(3, opts);
      expect(d).toBeGreaterThanOrEqual(2000);
      expect(d).toBeLessThanOrEqual(4000);
    }
  });
  it('zero jitter is deterministic; negative attempts are treated as 0', () => {
    expect(backoffDelay(2, { ...opts, jitter: 0 }, Math.random)).toBe(2000);
    expect(backoffDelay(-3, opts, () => 1)).toBe(500);
    expect(DEFAULT_BACKOFF.maxAttempts).toBeGreaterThan(3);
  });
});

const WATCHDOG = 99_999;
function harness(opts = {}, online = true) {
  const timers: { fn: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  const states: ReconnectState[] = [];
  const connect = vi.fn();
  const net = { online };
  const c = new ReconnectController({
    connect,
    onChange: (s) => states.push(s),
    setTimer: (fn, ms) => { const id = nextId++; timers.push({ fn, ms, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    now: () => 1000,
    random: () => 1,
    isOnline: () => net.online,
  }, { baseMs: 100, maxMs: 1000, jitter: 0.5, maxAttempts: 3, attemptTimeoutMs: WATCHDOG, ...opts });
  const retries = () => timers.filter((t) => t.ms !== WATCHDOG);
  const runTimer = () => { const t = retries()[0]; timers.splice(timers.indexOf(t), 1); t.fn(); return t.ms; };
  const fireWatchdog = () => { const t = timers.find((x) => x.ms === WATCHDOG)!; timers.splice(timers.indexOf(t), 1); t.fn(); };
  return { c, get timers() { return retries(); }, fireWatchdog, states, connect, net, runTimer };
}

describe('ReconnectController', () => {
  it('backs off exponentially after losing a good connection, then resets on success', () => {
    const h = harness();
    h.c.start();
    h.c.connected();
    expect(h.c.snapshot.status).toBe('connected');
    h.c.lost();
    expect(h.c.snapshot).toMatchObject({ status: 'reconnecting', attempt: 1, nextRetryAt: 1100 });
    expect(h.runTimer()).toBe(100);
    expect(h.connect).toHaveBeenCalledTimes(1);
    h.c.lost();
    expect(h.runTimer()).toBe(200);
    h.c.lost();
    expect(h.runTimer()).toBe(400);
    h.c.connected();
    expect(h.c.snapshot).toEqual({ status: 'connected', attempt: 0, nextRetryAt: null });
    h.c.lost();
    expect(h.timers[0].ms).toBe(100);
  });

  it('gives up after maxAttempts and waits for a manual Retry', () => {
    const h = harness();
    h.c.start();
    h.c.connected();
    for (let i = 0; i < 3; i++) { h.c.lost(); h.runTimer(); }
    h.c.lost();
    expect(h.c.snapshot.status).toBe('failed');
    expect(h.timers).toHaveLength(0);
    h.c.lost(); // further losses do nothing while failed
    expect(h.timers).toHaveLength(0);
    h.c.retryNow();
    expect(h.connect).toHaveBeenCalledTimes(4);
    expect(h.c.snapshot).toMatchObject({ status: 'reconnecting', attempt: 0 });
  });

  it('never stacks attempts: duplicate losses and wakes while a retry is pending or in flight', () => {
    const h = harness();
    h.c.start();
    h.c.connected();
    h.c.lost();
    h.c.lost();
    expect(h.timers).toHaveLength(1);
    h.c.wake(); // tab visible again: retry immediately instead of waiting
    expect(h.timers).toHaveLength(0);
    expect(h.connect).toHaveBeenCalledTimes(1);
    h.c.wake();
    h.c.online();
    expect(h.connect).toHaveBeenCalledTimes(1);
  });

  it('waits while offline without burning attempts, retries at once when back online', () => {
    const h = harness({}, false);
    h.c.start();
    h.c.connected();
    h.c.lost();
    expect(h.c.snapshot.status).toBe('offline');
    expect(h.timers).toHaveLength(0);
    h.net.online = true;
    h.c.online();
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.c.snapshot).toMatchObject({ status: 'reconnecting', attempt: 0 });
  });

  it('offline() cancels a scheduled retry; connected ignores offline (the socket reports its own loss)', () => {
    const h = harness();
    h.c.start();
    h.c.connected();
    h.c.offline();
    expect(h.c.snapshot.status).toBe('connected');
    h.c.lost();
    expect(h.timers).toHaveLength(1);
    h.c.offline();
    expect(h.timers).toHaveLength(0);
    expect(h.c.snapshot.status).toBe('offline');
  });

  it('an attempt that never resolves times out and is retried', () => {
    const h = harness();
    h.c.start();
    h.c.connected();
    h.c.lost();
    h.runTimer();
    expect(h.connect).toHaveBeenCalledTimes(1);
    h.fireWatchdog();
    expect(h.c.snapshot).toMatchObject({ status: 'reconnecting', attempt: 2 });
    h.runTimer();
    expect(h.connect).toHaveBeenCalledTimes(2);
    h.c.connected();
    expect(h.c.snapshot.status).toBe('connected');
  });

  it('initial connection failures also back off', () => {
    const h = harness();
    h.c.start();
    h.c.lost();
    expect(h.c.snapshot).toMatchObject({ status: 'reconnecting', attempt: 1 });
    expect(h.connect).toHaveBeenCalledTimes(0);
  });
});

describe('pending reducer calls', () => {
  it('rejects calls in flight when the connection is lost so the UI never stays busy', async () => {
    const never = new Promise(() => {});
    const call = trackCall(never);
    expect(pendingCallCount()).toBe(1);
    expect(abortPendingCalls()).toBe(1);
    await expect(call).rejects.toBeInstanceOf(ConnectionLostError);
    expect(pendingCallCount()).toBe(0);
  });
  it('settled calls pass through and are untracked', async () => {
    await expect(trackCall(Promise.resolve(7))).resolves.toBe(7);
    expect(pendingCallCount()).toBe(0);
  });
});
