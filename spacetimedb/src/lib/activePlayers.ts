import type { Identity } from 'spacetimedb';
import { PlayerState } from '../../../shared/sim';
import { hasWorldSpace } from '../../../shared/sim/admission';
import type { Ctx, PlayerRow } from './types';
import { overlay } from './playerStore';
import type { PlayerPosRow } from './types';

/**
 * The players the server has to look at, without reading every character ever
 * stored. `player.online` and `player.state` carry btree indexes, so the tick
 * reads the online characters and the (few) dead ones directly.
 *
 * A third, tiny group also used to be loaded by the tick's full scan: offline
 * characters still holding a combat target. Every way of going offline
 * (disconnect, permit expiry, revocation, end of visit) clears the target, and
 * only reducers for online players set one, so such rows exist only in data
 * saved before that rule. They are found by one full scan per module instance
 * (the first call after a publish or restart) and then re-read by primary key
 * until they no longer qualify.
 *
 * Test harnesses whose fake player table has no `online` accessor fall back
 * to the old full scan with the same predicate.
 *
 * Every list comes with live positions (lib/playerStore.ts overlay).
 */

interface InstanceState {
  /** Offline characters holding a combat target, by identity hex. */
  holders?: Map<string, Identity>;
  /** TERRAIN_VERSION already reconciled by this module instance. */
  terrain?: string;
  /** The tick's static blocked set, reused while the node positions are unchanged. */
  blocked?: { sig: number; set: Set<number>; version: number; trees: number };
}

/** Keyed on `ctx.db`, which the SDK builds once per module instance (and each test harness builds afresh). */
const INSTANCES = new WeakMap<object, InstanceState>();
const hex = (id: Identity) => id.toHexString();

export function instanceState(ctx: Ctx): InstanceState {
  let s = INSTANCES.get(ctx.db);
  if (!s) INSTANCES.set(ctx.db, (s = {}));
  return s;
}

type IndexedPlayerTable = {
  online?: { filter(v: boolean): Iterable<PlayerRow> };
  state?: { filter(v: number): Iterable<PlayerRow> };
};

function indexes(ctx: Ctx) {
  const table = ctx.db.player as unknown as IndexedPlayerTable;
  const online = table.online, state = table.state;
  return online && typeof online.filter === 'function' && state && typeof state.filter === 'function' ? { online, state } : undefined;
}

/** Every online character, any region. O(online) with the index. */
export function onlinePlayers(ctx: Ctx): PlayerRow[] {
  const idx = indexes(ctx);
  return overlay(ctx, idx ? idx.online.filter(true) : [...ctx.db.player.iter()].filter((p) => p.online));
}

/** Admission's world-full check (shared/sim/admission.ts) over the online characters only. */
export function worldHasSpace(ctx: Ctx, alreadyOnline = false): boolean {
  if (alreadyOnline) return true;
  const idx = indexes(ctx);
  return hasWorldSpace(idx ? idx.online.filter(true) : ctx.db.player.iter());
}

const isHolder = (p: PlayerRow) => !p.online && p.state !== PlayerState.Dead && p.combatTarget !== undefined;

function offlineHolders(ctx: Ctx): PlayerRow[] {
  const s = instanceState(ctx);
  if (!s.holders) {
    s.holders = new Map();
    for (const p of ctx.db.player.iter()) if (isHolder(p)) s.holders.set(hex(p.identity), p.identity);
  }
  const out: PlayerRow[] = [];
  for (const [h, id] of s.holders) {
    const p = ctx.db.player.identity.find(id);
    if (p && isHolder(p)) out.push(p); // offline: no player_pos row, the row's position is current
    // Online again or dead: the other two scans cover it. No target: it never gets one back while offline.
    else s.holders.delete(h);
  }
  return out;
}

/**
 * The characters any per-tick or "who is fighting whom" rule can affect:
 * online ones, the dead (respawn) and offline holders of a combat target.
 * Exactly the rows the old full scan kept, in no particular order.
 */
export function activePlayers(ctx: Ctx, positions?: Map<bigint | string, PlayerPosRow>): PlayerRow[] {
  const idx = indexes(ctx);
  if (!idx) return overlay(ctx, [...ctx.db.player.iter()].filter((p) => p.online || p.state === PlayerState.Dead || p.combatTarget !== undefined), positions);
  const out = [...idx.online.filter(true)];
  for (const p of idx.state.filter(PlayerState.Dead)) if (!p.online) out.push(p);
  out.push(...offlineHolders(ctx));
  return overlay(ctx, out, positions);
}

/** The active characters (see activePlayers) whose combat target is `target`. */
export function playersTargeting(ctx: Ctx, target: Identity): PlayerRow[] {
  const h = hex(target);
  return activePlayers(ctx).filter((p) => p.combatTarget !== undefined && hex(p.combatTarget) === h);
}
