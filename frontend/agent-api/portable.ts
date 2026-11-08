import { MAX_ONLINE_PLAYERS } from '../../shared/sim/admission';
import { JOIN_BUDGET, NETWORK_JOIN_BUDGET, REQUEST_BUDGET, WATCH_PASS_BUDGET, watchKeyVerdict } from './admissionPolicy';
import { createHash, randomBytes } from 'node:crypto';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
export function admissionError(error: unknown): ApiError | undefined {
  if (error instanceof ApiError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/world is full/.test(message)) return new ApiError(429, 'world_full', `This world has reached its ${MAX_ONLINE_PLAYERS}-player limit. Try again when a player leaves.`, 30);
  if (/world (character|permit) capacity/.test(message)) return new ApiError(429, 'character_capacity', 'This world cannot create more characters. Existing characters can still return.', 3600);
  return undefined;
}

/** Tokens can sit in a socket URL or an auth header quoted by an error message; none of them belong in a log. */
const scrub = (text: string) => text
  .replace(/(token=)[^\s&"']+/gi, '$1[redacted]')
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/\bbg[a-z]_[A-Za-z0-9_-]{43}/g, '[redacted]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted]');
/** An exception that is not a known refusal, for the server log only. Clients get a generic reply. */
export function unexpectedError(error: unknown): { name: string; message: string; stack?: string } {
  if (!(error instanceof Error)) return { name: 'non-error', message: scrub(String(error)).slice(0, 500) };
  return { name: error.name, message: scrub(error.message).slice(0, 500), ...(error.stack ? { stack: scrub(error.stack).slice(0, 2000) } : {}) };
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
export type Invite = { expiresAt: number; lifetimeSeconds: number; combat: boolean; chat: boolean };

/** A bounded token bucket; rejected requests never refill the budget. */
export class Budget {
  private tokens: number;
  private updated: number;
  constructor(private capacity: number, private perSecond: number, now = Date.now()) {
    this.tokens = capacity; this.updated = now;
  }
  take(now = Date.now()): void {
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.updated) * this.perSecond / 1000);
    this.updated = now;
    if (this.tokens < 1) throw new ApiError(429, 'rate_limited', 'Slow down and honor Retry-After.', Math.max(1, Math.ceil((1 - this.tokens) / this.perSecond)));
    this.tokens -= 1;
  }
}

/**
 * A /watch pass request's key, checked before any budget is charged: 403 when the world has no watch key (fail
 * closed), 401 for a wrong one, null when it may proceed to the pass lane.
 */
export function watchKeyError(key: string | undefined, authorization: string | null | undefined): ApiError | null {
  const verdict = watchKeyVerdict(key, authorization);
  if (verdict === 'disabled') return new ApiError(403, 'watch_disabled', 'This world has no watch key, so it cannot be watched.');
  if (verdict === 'invalid') return new ApiError(401, 'invalid_watch_key', 'This world needs its watch key.');
  return null;
}

export class AddressLimits {
  private entries = new Map<string, { requests: Budget; joins: Budget; lastSeen: number }>();
  private passes = new Map<string, { budget: Budget; lastSeen: number }>();
  /** /watch passes: their own lane per address (WATCH_PASS_BUDGET), apart from requests and joins. */
  takePass(ip: string, now = Date.now()) {
    const idle = Math.ceil(WATCH_PASS_BUDGET.burst / WATCH_PASS_BUDGET.perSecond) * 1000;
    for (const [key, entry] of this.passes) if (now - entry.lastSeen > idle) this.passes.delete(key);
    let entry = this.passes.get(ip);
    if (!entry) {
      if (this.passes.size >= 4096) throw new ApiError(429, 'capacity', 'Request capacity reached.', 60);
      entry = { budget: new Budget(WATCH_PASS_BUDGET.burst, WATCH_PASS_BUDGET.perSecond, now), lastSeen: now };
      this.passes.set(ip, entry);
    }
    entry.lastSeen = now;
    entry.budget.take(now);
  }
  private global = new Budget(REQUEST_BUDGET.burst, REQUEST_BUDGET.perSecond);
  private globalJoins = new Budget(JOIN_BUDGET.burst, JOIN_BUDGET.perSecond);
  take(ip: string, joining: boolean, now = Date.now()) {
    if (joining) this.globalJoins.take(now);
    else this.global.take(now);
    for (const [key, entry] of this.entries) if (now - entry.lastSeen > 300_000) this.entries.delete(key);
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= 4096) throw new ApiError(429, 'capacity', 'Request capacity reached.', 60);
      entry = { requests: new Budget(REQUEST_BUDGET.burst, REQUEST_BUDGET.perSecond, now), joins: new Budget(NETWORK_JOIN_BUDGET.burst, NETWORK_JOIN_BUDGET.perSecond, now), lastSeen: now };
      this.entries.set(ip, entry);
    }
    entry.lastSeen = now;
    entry.requests.take(now);
    if (joining) entry.joins.take(now);
  }
}

/**
 * JSON for every gateway reply and stored receipt: a stray BigInt (a u64 row id, an Identity's
 * __identity__) becomes its decimal string instead of throwing, so one unconverted field can
 * never turn a read or an action into an unexpected 500.
 */
export function toJson(body: unknown): string {
  return JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString() : value));
}
