import { createHash, randomBytes } from 'node:crypto';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
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
  private global = new Budget(200, 20);
  take(ip: string, joining: boolean, now = Date.now()) {
    this.global.take(now);
    for (const [key, entry] of this.entries) if (now - entry.lastSeen > 300_000) this.entries.delete(key);
    let entry = this.entries.get(ip);
    if (!entry) {
      if (this.entries.size >= 4096) throw new ApiError(429, 'capacity', 'Request capacity reached.', 60);
      entry = { requests: new Budget(60, 2, now), joins: new Budget(5, 1 / 60, now), lastSeen: now };
      this.entries.set(ip, entry);
    }
    entry.lastSeen = now;
    entry.requests.take(now);
    if (joining) entry.joins.take(now);
  }
}
