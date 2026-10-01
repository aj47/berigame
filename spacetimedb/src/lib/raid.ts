import {
  GIANT_ID, GIANT_MAX_HP, GiantEventKind, GiantState, PlayerState, RAID_WINDOW_MS, RaidOutcome, freshGiant, inBoulders, nextRaidWakeMs, raidMaxHp,
} from '../../../shared/sim';
import { emitGiantEvent, ensureGiant } from './giant';
import type { Ctx, GiantRaidRow, GiantRow, PlayerRow } from './types';

/** Milliseconds since the epoch of this reducer call. */
export function nowMs(ctx: Ctx): number {
  return Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
}

const micros = (ms: number) => BigInt(Math.floor(ms)) * 1000n;

/**
 * The raid row, inserted on first use. A database published before raids had
 * an always-awake Giant: it falls asleep here (one write, once) until the
 * next scheduled wake.
 */
export function ensureRaid(ctx: Ctx, tick: number): GiantRaidRow {
  const row = ctx.db.giantRaid.id.find(GIANT_ID);
  if (row) return row;
  const g = ensureGiant(ctx, tick);
  sleepGiantRow(ctx, g, tick);
  clearContributions(ctx);
  return ctx.db.giantRaid.insert({
    id: GIANT_ID, awake: false, nextWakeAtMicros: micros(nextRaidWakeMs(nowMs(ctx))), raidEndsAtMicros: 0n,
    announced: 0, raidPlayers: 0, lastOutcome: RaidOutcome.None, raidCount: 0,
  });
}

function sleepGiantRow(ctx: Ctx, g: GiantRow, tick: number): GiantRow {
  const next = { ...g, ...freshGiant(tick), x: g.x, z: g.z, hp: GIANT_MAX_HP, maxHp: GIANT_MAX_HP, state: GiantState.Asleep };
  ctx.db.giant.id.update(next);
  return next;
}

export function clearContributions(ctx: Ctx): void {
  for (const row of [...ctx.db.giantContribution.iter()]) ctx.db.giantContribution.identity.delete(row.identity);
}

/** Alive, online players in the Boulders: the raid's HP scale. */
export function countRaiders(players: Iterable<PlayerRow>): number {
  let n = 0;
  for (const p of players) if (p.online && p.state === PlayerState.Alive && inBoulders(p)) n++;
  return n;
}

/** The Giant wakes: raid HP from the players in the Boulders now, a fresh fight, the window starts. */
export function wakeGiant(ctx: Ctx, tick: number, raiders: number): { raid: GiantRaidRow; giant: GiantRow } {
  const raid = ensureRaid(ctx, tick);
  const g = ctx.db.giant.id.find(GIANT_ID) ?? ensureGiant(ctx, tick);
  const hp = raidMaxHp(raiders);
  clearContributions(ctx);
  const giant = { ...g, ...freshGiant(tick), x: g.x, z: g.z, hp, maxHp: hp, state: GiantState.Idle };
  ctx.db.giant.id.update(giant);
  const next = {
    ...raid, awake: true, raidEndsAtMicros: micros(nowMs(ctx) + RAID_WINDOW_MS), announced: 0,
    raidPlayers: raiders, raidCount: raid.raidCount + 1,
  };
  ctx.db.giantRaid.id.update(next);
  emitGiantEvent(ctx, { tick, kind: GiantEventKind.Wake, hp, quantity: raiders, x: g.x, z: g.z });
  return { raid: next, giant };
}

/**
 * Back to sleep (defeated, or the window ran out): the next wake is the next
 * slot on the UTC grid. Callers clear players' queued swings.
 */
export function sleepGiant(ctx: Ctx, tick: number, g: GiantRow, outcome: RaidOutcome): { raid: GiantRaidRow; giant: GiantRow } {
  const raid = ensureRaid(ctx, tick);
  const giant = sleepGiantRow(ctx, g, tick);
  clearContributions(ctx);
  const next = {
    ...raid, awake: false, raidEndsAtMicros: 0n, announced: 0, lastOutcome: outcome,
    nextWakeAtMicros: micros(nextRaidWakeMs(nowMs(ctx))),
  };
  ctx.db.giantRaid.id.update(next);
  emitGiantEvent(ctx, { tick, kind: GiantEventKind.Sleep, quantity: outcome, x: g.x, z: g.z });
  return { raid: next, giant };
}
