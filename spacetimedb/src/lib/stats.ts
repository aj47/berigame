import type { Identity } from 'spacetimedb';
import { areaOf, STICK_ITEM_ID, type Tile } from '../../../shared/sim';
import type { Ctx } from './types';

/**
 * Anonymous funnel counters (docs/ANALYTICS.md). Every helper is best-effort:
 * a stats failure must never break gameplay, so each call is wrapped.
 */
const STEPS = ['join', 'berry', 'stick', 'hedge', 'coast', 'craft'] as const;
type Step = (typeof STEPS)[number];
type StatsRow = NonNullable<ReturnType<Ctx['db']['playStats']['identity']['find']>>;

function furthest(a: string, b: Step): string {
  return STEPS.indexOf(b) > STEPS.indexOf(a as Step) ? b : a;
}

function edit(ctx: Ctx, id: Identity, fn: (row: StatsRow) => StatsRow | undefined): void {
  try {
    const row = ctx.db.playStats.identity.find(id);
    if (!row) return;
    const next = fn({ ...row });
    if (next) ctx.db.playStats.identity.update(next);
  } catch {
    /* never let analytics break a reducer */
  }
}

/**
 * `wasOnline`: the player already had a live connection before this one. When
 * they did not, any `sessionStartedAt` left behind is stale (the module
 * restarted, or a disconnect was never delivered): that session is closed out
 * (counted up to now) and a new one starts, instead of sessions stopping
 * being counted forever.
 */
export function statsSessionStart(ctx: Ctx, id: Identity, wasOnline = false): void {
  try {
    const row = ctx.db.playStats.identity.find(id);
    if (!row) {
      ctx.db.playStats.insert({
        identity: id, firstJoinAt: ctx.timestamp, lastSeenAt: ctx.timestamp, sessionStartedAt: ctx.timestamp,
        sessions: 1, totalPlayMicros: 0n, firstBerryAt: undefined, firstStickAt: undefined,
        reachedHedgeAt: undefined, reachedCoastAt: undefined, firstCraftAt: undefined, deaths: 0, lastStep: 'join',
      });
      return;
    }
    // A second tab of an already-online player does not start a new session.
    if (row.sessionStartedAt && wasOnline) return;
    if (row.sessionStartedAt) {
      statsSessionEnd(ctx, id);
      const closed = ctx.db.playStats.identity.find(id);
      if (!closed) return;
      ctx.db.playStats.identity.update({ ...closed, sessions: closed.sessions + 1, sessionStartedAt: ctx.timestamp, lastSeenAt: ctx.timestamp });
      return;
    }
    ctx.db.playStats.identity.update({ ...row, sessions: row.sessions + 1, sessionStartedAt: ctx.timestamp, lastSeenAt: ctx.timestamp });
  } catch { /* best-effort */ }
}

export function statsSessionEnd(ctx: Ctx, id: Identity): void {
  edit(ctx, id, (row) => {
    const now = ctx.timestamp.microsSinceUnixEpoch;
    const started = row.sessionStartedAt?.microsSinceUnixEpoch;
    const len = started !== undefined && now > started ? now - started : 0n;
    return { ...row, sessionStartedAt: undefined, totalPlayMicros: row.totalPlayMicros + len, lastSeenAt: ctx.timestamp };
  });
}

export function statsItem(ctx: Ctx, id: Identity, itemId: string): void {
  const isStick = itemId === STICK_ITEM_ID;
  const isBerry = itemId.includes('berry');
  if (!isStick && !isBerry) return;
  edit(ctx, id, (row) => {
    if (isStick && !row.firstStickAt) return { ...row, firstStickAt: ctx.timestamp, lastStep: furthest(row.lastStep, 'stick') };
    if (isBerry && !row.firstBerryAt) return { ...row, firstBerryAt: ctx.timestamp, lastStep: furthest(row.lastStep, 'berry') };
    return undefined;
  });
}

/** Called for players whose row changed in a tick; only looks up stats outside the Grove. */
export function statsPosition(ctx: Ctx, id: Identity, at: Tile): void {
  const area = areaOf(at);
  if (area === 'grove') return;
  edit(ctx, id, (row) => {
    if (area === 'hedge' && !row.reachedHedgeAt) return { ...row, reachedHedgeAt: ctx.timestamp, lastStep: furthest(row.lastStep, 'hedge') };
    // Past the boulder line counts as having reached the Coast (no separate Boulders column yet).
    if ((area === 'coast' || area === 'boulder-line' || area === 'boulders') && !row.reachedCoastAt) {
      return { ...row, reachedHedgeAt: row.reachedHedgeAt ?? ctx.timestamp, reachedCoastAt: ctx.timestamp, lastStep: furthest(row.lastStep, 'coast') };
    }
    return undefined;
  });
}

export function statsCraft(ctx: Ctx, id: Identity): void {
  edit(ctx, id, (row) => (row.firstCraftAt ? undefined : { ...row, firstCraftAt: ctx.timestamp, lastStep: furthest(row.lastStep, 'craft') }));
}

export function statsDeath(ctx: Ctx, id: Identity): void {
  edit(ctx, id, (row) => ({ ...row, deaths: row.deaths + 1 }));
}
