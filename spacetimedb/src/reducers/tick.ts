import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { tickSchedule } from '../tables';
import {
  DEATH_TICKS, EventKind, MELEE_RANGE, harvestTicksFor, isBerryNode, regrowTicksFor, Pending, PlayerState, SPAWN_TILE,
  MOVEMENT_STEPS_PER_TICK, STICK_ITEM_ID, SWING_INTERVAL_TICKS,
  bfsPath, chebyshev, enterRule, facingFromDelta, goalAdjacentTo,
  goalIsTile, harvestFindsStick, holdsItem, inGrace, inHotbar, inSafeRing, isNewcomer,
  neighbors8, swingDamage, tileKey, DUMMY_TILE, dummyAfterHit, worldBlockedSet,
} from '../../../shared/sim';
import { ensureDummy } from '../lib/dummy';
import { holdsStick } from '../lib/brambles';
import { emitEvent } from '../lib/events';
import { seedMissingNodes } from '../lib/nodes';
import { statsDeath, statsPosition } from '../lib/stats';
import { dropOnGround, giveItem, readSlots, takeGroundItem } from '../lib/inventory';
import { clearInteractions, hex, sameId } from '../lib/players';
import { canPlay } from '../lib/access';
import type { Ctx, PlayerRow, TrainingDummyRow, TreeRow } from '../lib/types';

interface TickState {
  ctx: Ctx;
  T: number;
  players: Map<string, PlayerRow>;
  order: string[];
  dirty: Set<string>;
  trees: Map<number, TreeRow>;
  dirtyTrees: Set<number>;
  blocked: Set<number>;
}

function mark(s: TickState, p: PlayerRow): void {
  s.dirty.add(hex(p.identity));
}

function markTree(s: TickState, t: TreeRow): void {
  s.dirtyTrees.add(t.id);
}

function releaseTreeInTick(s: TickState, p: PlayerRow): void {
  if (p.harvestTreeId !== 0) {
    const tree = s.trees.get(p.harvestTreeId);
    if (tree && sameId(tree.harvester, p.identity)) {
      tree.harvester = undefined;
      markTree(s, tree);
    }
  }
  p.harvestTreeId = 0;
  p.harvestEndTick = 0;
}

/** Anything that hurts you interrupts what you were doing with your hands. */
function interrupt(s: TickState, p: PlayerRow): void {
  if (p.harvestTreeId !== 0 || p.pending !== Pending.None) {
    releaseTreeInTick(s, p);
    p.pending = Pending.None;
    p.pendingId = 0n;
    mark(s, p);
  }
}

function alive(p: PlayerRow): boolean {
  return p.online && p.state === PlayerState.Alive;
}

function phaseRespawn(s: TickState): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (p.state !== PlayerState.Dead || p.respawnTick > s.T) continue;
    p.state = PlayerState.Alive;
    p.hp = p.maxHp;
    p.x = SPAWN_TILE.x;
    p.z = SPAWN_TILE.z;
    p.facing = 0;
    p.targetX = undefined;
    p.targetZ = undefined;
    p.combatTarget = undefined;
    p.hostile = false;
    p.pending = Pending.None;
    p.pendingId = 0n;
    mark(s, p);
  }
}

function tryClaimTree(s: TickState, p: PlayerRow, tree: TreeRow): boolean {
  if (tree.harvester !== undefined || tree.cooldownUntilTick > s.T) return false;
  tree.harvester = p.identity;
  markTree(s, tree);
  p.harvestTreeId = tree.id;
  p.harvestEndTick = s.T + harvestTicksFor(tree.kind);
  return true;
}

function resolvePending(s: TickState, p: PlayerRow): void {
  if (p.pending === Pending.Harvest) {
    const tree = s.trees.get(Number(p.pendingId));
    if (!tree) {
      p.pending = Pending.None; p.pendingId = 0n; mark(s, p);
      return;
    }
    if (chebyshev(p, tree) <= MELEE_RANGE) {
      // A regrowing or claimed tree keeps you waiting beside it (wait-and-claim).
      if (tryClaimTree(s, p, tree)) { p.pending = Pending.None; p.pendingId = 0n; }
      p.targetX = undefined; p.targetZ = undefined;
      mark(s, p);
    }
  } else if (p.pending === Pending.Dummy) {
    // Stop at the first tile in reach; the swing phase does the rest.
    if (chebyshev(p, DUMMY_TILE) <= MELEE_RANGE && p.targetX !== undefined) {
      p.targetX = undefined; p.targetZ = undefined;
      mark(s, p);
    }
  } else if (p.pending === Pending.Pickup) {
    const item = s.ctx.db.groundItem.id.find(p.pendingId);
    if (!item) {
      p.pending = Pending.None; p.pendingId = 0n;
      p.targetX = undefined; p.targetZ = undefined;
      mark(s, p);
      return;
    }
    if (chebyshev(p, item) <= MELEE_RANGE) {
      const taken = takeGroundItem(s.ctx, p.identity, item);
      if (taken > 0 && item.itemId === STICK_ITEM_ID && p.respawnTick > s.T) p.respawnTick = s.T;
      p.pending = Pending.None; p.pendingId = 0n;
      p.targetX = undefined; p.targetZ = undefined;
      mark(s, p);
    }
  }
}

/**
 * Wait-and-claim: every free tree goes to one of the players waiting beside
 * it: newcomers (first-spawn grace) first, then the earliest last input, then
 * tick order.
 */
function phaseClaims(s: TickState): void {
  const rank = new Map(s.order.map((h, i) => [h, i]));
  for (const tree of s.trees.values()) {
    if (tree.harvester !== undefined || tree.cooldownUntilTick > s.T) continue;
    let best: PlayerRow | undefined;
    for (const h of s.order) {
      const p = s.players.get(h)!;
      if (!alive(p) || p.pending !== Pending.Harvest || Number(p.pendingId) !== tree.id) continue;
      if (chebyshev(p, tree) > MELEE_RANGE || p.harvestTreeId !== 0) continue;
      if (!best) { best = p; continue; }
      const pn = isNewcomer(p, s.T), bn = isNewcomer(best, s.T);
      if (pn !== bn) { if (pn) best = p; continue; }
      if (p.lastInputTick !== best.lastInputTick) { if (p.lastInputTick < best.lastInputTick) best = p; continue; }
      if (rank.get(h)! < rank.get(hex(best.identity))!) best = p;
    }
    if (best && tryClaimTree(s, best, tree)) {
      best.pending = Pending.None; best.pendingId = 0n;
      best.targetX = undefined; best.targetZ = undefined;
      mark(s, best);
    }
  }
}

function phaseMovement(s: TickState): void {
  phaseClaims(s);
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (!alive(p)) continue;

    let goal: ((t: { x: number; z: number }) => boolean) | null = null;
    if (p.combatTarget) {
      const tgt = s.players.get(hex(p.combatTarget));
      if (!tgt || !alive(tgt)) {
        p.combatTarget = undefined;
        p.hostile = false;
        mark(s, p);
      } else if (chebyshev(p, tgt) > MELEE_RANGE) {
        goal = goalAdjacentTo(tgt, s.blocked, MELEE_RANGE);
      }
    } else if (p.targetX !== undefined && p.targetZ !== undefined) {
      const target = { x: p.targetX, z: p.targetZ };
      if (p.x === target.x && p.z === target.z) {
        p.targetX = undefined; p.targetZ = undefined; mark(s, p);
      } else {
        goal = goalIsTile(target);
      }
    }

    if (goal) {
      // The path validates every intermediate tile and both sides of a
      // diagonal. Taking its first two steps cannot tunnel through a tree or
      // overshoot the first tile satisfying a melee/follow goal.
      // One-way brambles. Recomputed every tick, so dropping the stick mid-route
      // makes the path fail and the player stops where they are.
      const path = bfsPath(p, goal, s.blocked, enterRule(holdsStick(s.ctx, p)));
      if (!path || path.length === 0) {
        if (!p.combatTarget) { p.targetX = undefined; p.targetZ = undefined; }
        if (p.pending !== Pending.None) { p.pending = Pending.None; p.pendingId = 0n; }
        mark(s, p);
      } else {
        for (const step of path.slice(0, MOVEMENT_STEPS_PER_TICK)) {
          p.facing = facingFromDelta(step.x - p.x, step.z - p.z);
          p.x = step.x;
          p.z = step.z;
          if (!p.combatTarget && p.targetX === p.x && p.targetZ === p.z) {
            p.targetX = undefined;
            p.targetZ = undefined;
          }
          mark(s, p);
          // Harvest/pickup stops at the first reachable interaction tile,
          // including when that is the first half of this tick's travel.
          if (p.pending !== Pending.None) {
            resolvePending(s, p);
            if (p.pending === Pending.None || p.targetX === undefined) break;
          }
        }
      }
    }

    if (p.pending !== Pending.None) resolvePending(s, p);
  }
}

function phaseHarvest(s: TickState): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (!alive(p) || p.harvestTreeId === 0 || p.harvestEndTick > s.T) continue;
    const tree = s.trees.get(p.harvestTreeId);
    if (tree && sameId(tree.harvester, p.identity) && chebyshev(p, tree) <= MELEE_RANGE) {
      giveItem(s.ctx, p.identity, tree.itemId, 1, p, s.T);
      tree.cooldownUntilTick = s.T + regrowTicksFor(tree.kind);
      tree.harvester = undefined;
      markTree(s, tree);
      emitEvent(s.ctx, { tick: s.T, kind: EventKind.HarvestDone, attacker: p.identity, defender: p.identity, itemId: tree.itemId, defenderHp: p.hp });
      // ctx.random is seeded from the tick timestamp and drawn in s.order, so replays agree.
      // Draw on every berry harvest (the draw order never changes); holders find no spare.
      // Only berry trees find sticks: Coast nodes never draw.
      const berry = isBerryNode(tree);
      const roll = berry ? s.ctx.random() : 1;
      const holding = !berry || p.weapon === STICK_ITEM_ID || holdsItem(readSlots(s.ctx, p.identity).slots, '', STICK_ITEM_ID);
      if (berry && harvestFindsStick(roll, holding)) {
        giveItem(s.ctx, p.identity, STICK_ITEM_ID, 1, p, s.T);
        // A find ends first-spawn grace: 10 more ticks to wield it and step back.
        if (p.respawnTick > s.T) p.respawnTick = s.T;
        emitEvent(s.ctx, { tick: s.T, kind: EventKind.ItemFound, attacker: p.identity, defender: p.identity, itemId: STICK_ITEM_ID, defenderHp: p.hp });
      }
      p.harvestTreeId = 0;
      p.harvestEndTick = 0;
    } else {
      releaseTreeInTick(s, p);
    }
    mark(s, p);
  }
}

function phaseSwings(s: TickState): void {
  for (const h of s.order) {
    const a = s.players.get(h)!;
    if (!alive(a) || !a.combatTarget || !a.hostile) continue;
    const d = s.players.get(hex(a.combatTarget));
    if (!d || !alive(d)) {
      a.combatTarget = undefined; a.hostile = false; mark(s, a);
      continue;
    }
    if (chebyshev(a, d) > MELEE_RANGE) continue;
    // Nothing lands in the safe ring or on a player in grace; the fight waits.
    if (inSafeRing(a) || inSafeRing(d) || inGrace(d, s.T)) continue;
    const face = facingFromDelta(d.x - a.x, d.z - a.z);
    if (a.facing !== face) { a.facing = face; mark(s, a); }
    if (s.T < a.nextSwingTick) continue;

    // The defender turns to face the swing so the hit reaction meets the incoming blow.
    d.facing = facingFromDelta(a.x - d.x, a.z - d.z);
    // Reducers keep a wielded weapon in the hotbar; re-check so a stale row can only ever punch.
    if (a.weapon !== '' && !inHotbar(readSlots(s.ctx, a.identity).slots, a.weapon)) a.weapon = '';
    const damage = swingDamage(a.weapon);
    d.hp = Math.max(0, d.hp - damage);
    a.nextSwingTick = s.T + SWING_INTERVAL_TICKS;
    interrupt(s, d);

    emitEvent(s.ctx, {
      tick: s.T,
      kind: EventKind.Hit,
      attacker: a.identity,
      defender: d.identity,
      damage,
      itemId: a.weapon,
      defenderHp: d.hp,
    });
    mark(s, a);
    mark(s, d);
  }
}

/**
 * Training dummy swings. The dummy row is read only when someone is due to
 * hit it this tick, so an idle dummy costs one pass over players and no I/O.
 */
function phaseDummySwings(s: TickState): void {
  let dummy: TrainingDummyRow | undefined;
  let dirty = false;
  for (const h of s.order) {
    const a = s.players.get(h)!;
    if (!alive(a) || a.pending !== Pending.Dummy || a.combatTarget) continue;
    if (!dummy) {
      const row = s.ctx.db.trainingDummy.id.find(Number(a.pendingId));
      if (!row) { a.pending = Pending.None; a.pendingId = 0n; mark(s, a); continue; }
      dummy = { ...row };
    }
    if (Number(a.pendingId) !== dummy.id || chebyshev(a, dummy) > MELEE_RANGE) continue;
    const face = facingFromDelta(dummy.x - a.x, dummy.z - a.z);
    if (a.facing !== face) { a.facing = face; mark(s, a); }
    if (s.T < a.nextSwingTick) continue;
    if (a.weapon !== '' && !inHotbar(readSlots(s.ctx, a.identity).slots, a.weapon)) a.weapon = '';
    const damage = swingDamage(a.weapon);
    const { hp, reset } = dummyAfterHit(dummy, damage, s.T);
    dummy.hp = hp;
    dummy.lastHitTick = s.T;
    dirty = true;
    a.nextSwingTick = s.T + SWING_INTERVAL_TICKS;
    s.ctx.db.dummyEvent.insert({ tick: s.T, dummyId: dummy.id, attacker: a.identity, damage, itemId: a.weapon, hp, reset });
    mark(s, a);
  }
  if (dummy && dirty) s.ctx.db.trainingDummy.id.update(dummy);
}

function phaseDeath(s: TickState): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (!alive(p) || p.hp > 0) continue;

    // Drop everything around the body.
    const snap = readSlots(s.ctx, p.identity);
    const spots = neighbors8(p).filter((t) => !s.blocked.has(tileKey(t)));
    snap.slots.forEach((slot, i) => {
      if (!slot) return;
      const at = spots.length > 0 ? spots[i % spots.length] : p;
      dropOnGround(s.ctx, p.identity, slot.itemId, slot.quantity, at, s.T, true);
    });
    for (const row of snap.rows.values()) s.ctx.db.inventorySlot.id.delete(row.id);

    releaseTreeInTick(s, p);
    p.state = PlayerState.Dead;
    p.respawnTick = s.T + DEATH_TICKS;
    p.targetX = undefined; p.targetZ = undefined;
    p.combatTarget = undefined; p.hostile = false;
    p.pending = Pending.None; p.pendingId = 0n;
    // The whole inventory was just dropped, weapon included.
    p.weapon = '';
    mark(s, p);

    for (const oh of s.order) {
      const q = s.players.get(oh)!;
      if (q.combatTarget && sameId(q.combatTarget, p.identity)) {
        q.combatTarget = undefined;
        q.hostile = false;
        mark(s, q);
      }
    }
    emitEvent(s.ctx, { tick: s.T, kind: EventKind.Death, attacker: p.identity, defender: p.identity, defenderHp: 0 });
    statsDeath(s.ctx, p.identity);
  }
}

/** Field-by-field equality of a row and its working copy (identities by value). */
function sameRow<T extends object>(a: T | undefined, b: T): boolean {
  if (!a) return false;
  for (const key of Object.keys(b) as (keyof T)[]) {
    const x = a[key] as any, y = b[key] as any;
    if (x === y) continue;
    if (x && y && typeof x === 'object' && typeof y === 'object' && '__identity__' in x && '__identity__' in y && x.__identity__ === y.__identity__) continue;
    return false;
  }
  return true;
}

function phaseExpiry(s: TickState): void {
  if (s.T % 10 !== 0) return;
  for (const item of [...s.ctx.db.groundItem.iter()]) {
    if (item.expiresTick <= s.T) s.ctx.db.groundItem.id.delete(item.id);
  }
}

export const tick = spacetimedb.reducer(
  { name: 'tick', onSchedule: tickSchedule },
  { timer: tickSchedule.rowType },
  (ctx, _args) => {
    // Scheduled runs are invoked by the database itself; clients calling this directly are rejected.
    if (!sameId(ctx.sender, ctx.identity)) throw new SenderError('tick is scheduler-only');
    const world = ctx.db.world.id.find(0);
    if (!world) return;
    const T = world.tick + 1;

    // One pass over the player table. The tick works on the players it can
    // affect: online ones, the dead (respawn), and anyone still holding a
    // combat target. Everyone else would be skipped by every phase (none is
    // alive) and reads as absent, exactly like an offline target, so the
    // phases stay O(active players) however many have ever joined.
    const players = new Map<string, PlayerRow>();
    const original = new Map<string, PlayerRow>();
    for (const row of ctx.db.player.iter()) {
      let player = row;
      // Expiry/revocation stops queued movement, harvesting and combat even if a
      // client keeps its WebSocket open and sends no further requests.
      if (player.online && !canPlay(ctx, player.identity)) {
        const p = { ...player, online: false };
        clearInteractions(ctx, p);
        ctx.db.player.identity.update(p);
        player = p;
      }
      if (!player.online && player.state !== PlayerState.Dead && player.combatTarget === undefined) continue;
      const h = hex(player.identity);
      original.set(h, player);
      players.set(h, { ...player });
    }
    const trees = new Map<number, TreeRow>();
    const originalTrees = new Map<number, TreeRow>();
    for (const t of ctx.db.tree.iter()) { originalTrees.set(t.id, t); trees.set(t.id, { ...t }); }
    // Coast nodes: seed any missing id (a database published before M2). Idempotent.
    for (const row of seedMissingNodes(ctx, (id) => trees.has(id))) trees.set(row.id, { ...row });
    // The Grove's training dummy (a database published before it existed gets it here). One index lookup.
    ensureDummy(ctx);

    const s: TickState = {
      ctx,
      T,
      players,
      order: [...players.keys()].sort(),
      dirty: new Set(),
      trees,
      dirtyTrees: new Set(),
      blocked: worldBlockedSet(trees.values()),
    };

    phaseRespawn(s);
    phaseMovement(s);
    phaseHarvest(s);
    phaseSwings(s);
    phaseDummySwings(s);
    phaseDeath(s);
    phaseExpiry(s);

    ctx.db.world.id.update({ ...world, tick: T, tickStartedAt: ctx.timestamp });
    // Write (and broadcast) only rows that actually changed this tick.
    for (const h of s.dirty) {
      const p = players.get(h)!;
      const before = original.get(h)!;
      if (!sameRow(before, p)) {
        ctx.db.player.identity.update(p);
        if (before.x !== p.x || before.z !== p.z) statsPosition(ctx, p.identity, p);
      }
    }
    for (const id of s.dirtyTrees) {
      const t = trees.get(id)!;
      if (!sameRow(originalTrees.get(id), t)) ctx.db.tree.id.update(t);
    }
  }
);
