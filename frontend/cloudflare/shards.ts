import { createHash, randomBytes } from 'node:crypto';

/**
 * Agent session shards (docs/AGENT_API.md "Session shards"). The coordinator Durable Object (HOME_GATEWAY) keeps
 * admission, invites, renewals, recoveries, accounts and MCP keys. Agent sessions, with their sockets, receipts and
 * read/action budgets, live in shard objects of the same class named `beta-v1/agents/<slot>`.
 *
 * A session token names its shard in its first character after `bgs_`, so the edge routes a request without any
 * lookup and tokens keep their 47-character shape: `bgs_` + one base64url slot character + 42 random characters
 * (252 bits). A renewal keeps its slot (stored in the renewal config), so a session stays in one shard for life.
 */
export const HOME_GATEWAY = 'beta-v1';
/** Set by the edge (or the coordinator for MCP calls) on requests it routed to a shard; never trusted from clients. */
export const SHARD_HEADER = 'X-BeriGame-Shard';
const SLOTS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const PREFIX = '/api/agent/v1';

export const shardName = (slot: number) => `${HOME_GATEWAY}/agents/${slot}`;

/** Paths a session bearer is spent on: these go to the session's shard. */
export const sessionPath = (path: string) => [`${PREFIX}/state`, `${PREFIX}/danger`, `${PREFIX}/session`].includes(path) || path.startsWith(`${PREFIX}/actions/`);

/** A new session token for a shard slot, or the plain unsharded form for the coordinator (slot null). */
export function sessionToken(slot: number | null) {
  const random = randomBytes(32).toString('base64url');
  return slot === null ? `bgs_${random}` : `bgs_${SLOTS[slot]}${random.slice(0, 42)}`;
}

/** The shard a session bearer names, or null (no session token, unsharded, or a slot beyond the current count). */
export function tokenSlot(authorization: string | null, shards: number): number | null {
  const token = authorization?.match(/^Bearer (bgs_[A-Za-z0-9_-]{43})$/)?.[1];
  if (!token || shards === 0) return null;
  const slot = SLOTS.indexOf(token[4]);
  return slot < shards ? slot : null;
}

/** First placement of a session: spread by its id. */
export function slotForSession(sessionId: string, shards: number) {
  return createHash('sha256').update(sessionId).digest().readUInt32BE(0) % shards;
}

/** The slot a renewal config remembers, if it is still a current shard. */
export function shardOf(config: { slot?: unknown }, shards: number): number | null {
  return typeof config.slot === 'number' && Number.isInteger(config.slot) && config.slot >= 0 && config.slot < shards ? config.slot : null;
}
