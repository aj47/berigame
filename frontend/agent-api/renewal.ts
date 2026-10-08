import { ApiError, digest, secret } from './portable';
import { IDLE_LOGOUT_MINUTES } from '../../shared/sim/admission';

/**
 * Persistent browser identity (roadmap F1).
 *
 * A browser that redeemed a player invite also receives a renewal token
 * (`bgr_` + 256 random bits). The gateway stores only its SHA-256 digest, bound
 * server-side to one SpacetimeDB identity; the caller never names an identity,
 * so a token cannot be pointed at someone else's character. Each use rotates
 * the token. The previous token stays recognisable for a short grace so a
 * second tab that raced the first gets "renewed elsewhere" instead of losing the
 * character; replaying it after the grace is treated as theft and ends renewal.
 */
export const RENEW_PREFIX = 'bgr_';
export const RENEWAL_TTL_MS = 30 * 86400_000;
export const ROTATION_GRACE_MS = 120_000;
export const MAX_RENEWALS = 10_000;

export type RenewalRow = {
  key: string; prev_key: string | null; prev_until: number;
  identity: string; session_id: string; config: string; expires_at: number;
};
export interface RenewalStore {
  byKey(key: string): RenewalRow | undefined;
  byPrev(key: string): RenewalRow | undefined;
  count(): number;
  /** Insert or replace the row for row.identity. */
  put(row: RenewalRow): void;
  removeIdentity(identity: string): void;
}

export const visitEnded = () => new ApiError(401, 'visit_ended', 'This island sign-in can no longer be renewed. Use a new invite to return.');
/** The world logged this character out for inactivity (spacetimedb/src/lib/idle.ts); only an explicit return renews it. */
export const idleLogout = () => new ApiError(409, 'idle_logout', `Logged out after ${IDLE_LOGOUT_MINUTES} minutes without a game action. Renew with {"resume": true} to return.`);
/** Maps a module refusal to the gateway error a returning player should see, or undefined. */
export const renewalRefusal = (error: unknown) => /inactivity/.test(error instanceof Error ? error.message : String(error)) ? idleLogout() : undefined;
export const renewedElsewhere = () => new ApiError(409, 'renewed_elsewhere', 'Another tab already renewed this visit. Reload the saved sign-in and retry.', 1);

/** Creates the first renewal token for a freshly admitted browser identity. */
export function issueRenewal(store: RenewalStore, identity: string, sessionId: string, config: string, now: number) {
  if (store.count() >= MAX_RENEWALS) throw new ApiError(429, 'renewal_capacity', 'Returning-player capacity reached.', 3600);
  const token = secret(RENEW_PREFIX);
  store.put({ key: digest(token), prev_key: null, prev_until: 0, identity, session_id: sessionId, config, expires_at: now + RENEWAL_TTL_MS });
  return token;
}

/** Resolves a presented token to its row, or throws. Does not modify the row except on detected reuse. */
export function lookupRenewal(store: RenewalStore, token: string, now: number): RenewalRow {
  if (!token.startsWith(RENEW_PREFIX)) throw visitEnded();
  const key = digest(token);
  const row = store.byKey(key);
  if (row) {
    if (row.expires_at <= now) { store.removeIdentity(row.identity); throw visitEnded(); }
    return row;
  }
  const rotated = store.byPrev(key);
  if (rotated) {
    if (rotated.prev_until > now) throw renewedElsewhere();
    // An old token used after rotation: one of the two holders is not the owner.
    store.removeIdentity(rotated.identity);
  }
  throw visitEnded();
}

/** Rotates after the world accepted the renewal. Returns the new token, or throws if another request rotated first. */
export function rotateRenewal(store: RenewalStore, presented: RenewalRow, now: number) {
  const current = store.byKey(presented.key);
  if (!current || current.identity !== presented.identity) throw renewedElsewhere();
  const token = secret(RENEW_PREFIX);
  store.put({ ...current, key: digest(token), prev_key: current.key, prev_until: now + ROTATION_GRACE_MS, expires_at: now + RENEWAL_TTL_MS });
  return token;
}
