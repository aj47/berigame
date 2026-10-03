import { MAX_ONLINE_PLAYERS } from '../../shared/sim/admission';
import { JOIN_BUDGET, NETWORK_JOIN_BUDGET, REQUEST_BUDGET } from './admissionPolicy';
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

export class AddressLimits {
  private entries = new Map<string, { requests: Budget; joins: Budget; lastSeen: number }>();
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
