import type { Identity } from 'spacetimedb';
import { TICK_MS } from '../../../shared/sim';
import type { ActivityCounter } from '../../../shared/sim/adminStats';
import type { Ctx } from './types';

/**
 * Daily activity counters for the admin panel (docs/ANALYTICS.md). Like
 * lib/stats.ts every helper is best-effort: an analytics failure must never
 * break gameplay, and a module without the table simply records nothing.
 */
type ActivityRow = NonNullable<ReturnType<Ctx['db']['dailyActivity']['key']['find']>>;

/** The tick samples online time this often: 100 ticks = one minute. */
export const ACTIVITY_SAMPLE_TICKS = 100;
const SAMPLE_SECONDS = (ACTIVITY_SAMPLE_TICKS * TICK_MS) / 1000;

const utcDay = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 86_400_000_000n);

function edit(ctx: Ctx, id: Identity, fn: (row: ActivityRow) => void): void {
  try {
    const table = ctx.db.dailyActivity;
    if (!table) return;
    const day = utcDay(ctx);
    const key = `${day}:${id.toHexString()}`;
    const found = table.key.find(key);
    const row: ActivityRow = found ? { ...found } : {
      key, day, identity: id, agent: !!ctx.db.playerGrant.identity.find(id)?.agent,
      sessions: 0, playSeconds: 0, harvests: 0, gathered: 0, crafts: 0, kills: 0, deaths: 0, trades: 0, deposits: 0, chats: 0, actions: '{}',
    };
    fn(row);
    if (found) table.key.update(row);
    else table.insert(row);
  } catch {
    /* never let analytics break a reducer */
  }
}

/** Adds to one counter of today's row, creating the row (the character counts as active today). */
export function activity(ctx: Ctx, id: Identity, counter: Exclude<ActivityCounter, 'playSeconds'>, amount = 1): void {
  edit(ctx, id, (row) => { row[counter] += amount; });
}

/** Counts a named action, e.g. a region action (`gather`, `build`) or a vault withdrawal. */
export function activityAction(ctx: Ctx, id: Identity, action: string): void {
  if (!action || action.length > 32) return;
  edit(ctx, id, (row) => {
    const actions = JSON.parse(row.actions || '{}') as Record<string, number>;
    actions[action] = (actions[action] ?? 0) + 1;
    row.actions = JSON.stringify(actions);
  });
}

/**
 * Once a minute, credits a minute of play to everyone connected. Sampling
 * splits long sessions across UTC days and keeps idle characters in the DAU.
 */
export function activityHeartbeat(ctx: Ctx, T: number): void {
  if (T % ACTIVITY_SAMPLE_TICKS !== 0 || !ctx.db.dailyActivity) return;
  for (const p of ctx.db.player.iter()) {
    if (p.online && p.connections > 0) edit(ctx, p.identity, (row) => { row.playSeconds += SAMPLE_SECONDS; });
  }
}
