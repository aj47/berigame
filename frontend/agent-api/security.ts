import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = (prefix: string) => prefix + randomBytes(32).toString('base64url');
export type Invite = { expiresAt: number; lifetimeSeconds: number; combat: boolean; chat: boolean };

/** A separate file per invite allows atomic, durable single-use redemption. */
export class InviteStore {
  constructor(private directory: string) {}
  private async prepare() {
    await mkdir(join(this.directory, 'invites'), { recursive: true, mode: 0o700 });
    await mkdir(join(this.directory, 'spent'), { recursive: true, mode: 0o700 });
  }
  async issue(invite: Invite): Promise<string> {
    await this.prepare();
    const code = secret('bgi_');
    await writeFile(join(this.directory, 'invites', digest(code) + '.json'), JSON.stringify(invite), { mode: 0o600, flag: 'wx' });
    return code;
  }
  async consume(code: string, now = Date.now()): Promise<Invite> {
    const invalid = () => new ApiError(401, 'invalid_invite', 'This invite is invalid, expired, or already used.');
    if (!/^bgi_[A-Za-z0-9_-]{43}$/.test(code)) throw invalid();
    await this.prepare();
    const file = digest(code) + '.json';
    const used = join(this.directory, 'spent', file);
    try {
      // Claim before any await that creates a game connection. A second caller,
      // including another process, cannot redeem the same source file.
      await rename(join(this.directory, 'invites', file), used);
    } catch (error: any) {
      if (error.code === 'ENOENT') throw invalid();
      throw new ApiError(503, 'invite_store_unavailable', 'Invite storage is unavailable.');
    }
    let invite: Invite;
    try { invite = JSON.parse(await readFile(used, 'utf8')); } catch { throw invalid(); }
    if (!Number.isSafeInteger(invite.expiresAt) || invite.expiresAt <= now
      || !Number.isInteger(invite.lifetimeSeconds) || invite.lifetimeSeconds < 60 || invite.lifetimeSeconds > 3600
      || typeof invite.combat !== 'boolean' || typeof invite.chat !== 'boolean') throw invalid();
    return invite;
  }
}

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
