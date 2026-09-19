import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { tickSchedule } from '../tables';
import {
  DEATH_TICKS, EventKind, FightState, HARVEST_TICKS, type Stance, MELEE_RANGE, Pending, PlayerState, SPAWN_TILE,
  SWING_INTERVAL_TICKS, TREE_COOLDOWN_TICKS,
  bfsNextStep, blockedSetFromTiles, chebyshev, decayFightState, facingFromDelta, goalAdjacentTo,
  goalIsTile, knockbackTile, neighbors8, resolveSwing, tileKey,
} from '../../../shared/sim';
import { emitEvent } from '../lib/events';
import { dropOnGround, giveItem, readSlots } from '../lib/inventory';
import { hex, sameId } from '../lib/players';
import type { Ctx, PlayerRow, TreeRow } from '../lib/types';

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
    p.fightState = FightState.Neutral;
    p.targetX = undefined;
    p.targetZ = undefined;
    p.combatTarget = undefined;
    p.hostile = false;
    p.pending = Pending.None;
    p.pendingId = 0n;
    p.outOfRangeTicks = 0;
    mark(s, p);
  }
}

function tryClaimTree(s: TickState, p: PlayerRow, tree: TreeRow): boolean {
  if (tree.harvester !== undefined || tree.cooldownUntilTick > s.T) return false;
  tree.harvester = p.identity;
  markTree(s, tree);
  p.harvestTreeId = tree.id;
  p.harvestEndTick = s.T + HARVEST_TICKS;
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
      tryClaimTree(s, p, tree);
      p.pending = Pending.None; p.pendingId = 0n;
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
      const taken = giveItem(s.ctx, p.identity, item.itemId, item.quantity, p, s.T);
      if (taken >= item.quantity) s.ctx.db.groundItem.id.delete(item.id);
      else if (taken > 0) s.ctx.db.groundItem.id.update({ ...item, quantity: item.quantity - taken });
      p.pending = Pending.None; p.pendingId = 0n;
      p.targetX = undefined; p.targetZ = undefined;
      mark(s, p);
    }
  }
}

function phaseMovement(s: TickState): void {
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
      const step = bfsNextStep(p, goal, s.blocked);
      if (!step) {
        if (!p.combatTarget) { p.targetX = undefined; p.targetZ = undefined; }
        if (p.pending !== Pending.None) { p.pending = Pending.None; p.pendingId = 0n; }
        mark(s, p);
      } else {
        p.facing = facingFromDelta(step.x - p.x, step.z - p.z);
        p.x = step.x;
        p.z = step.z;
        if (!p.combatTarget && p.targetX === p.x && p.targetZ === p.z) {
          p.targetX = undefined;
          p.targetZ = undefined;
        }
        mark(s, p);
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
      tree.cooldownUntilTick = s.T + TREE_COOLDOWN_TICKS;
      tree.harvester = undefined;
      markTree(s, tree);
      emitEvent(s.ctx, { tick: s.T, kind: EventKind.HarvestDone, attacker: p.identity, defender: p.identity, defenderHp: p.hp });
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
    if (chebyshev(a, d) > MELEE_RANGE) {
      a.outOfRangeTicks = Math.min(255, a.outOfRangeTicks + 1);
      mark(s, a);
      continue;
    }
    if (a.outOfRangeTicks !== 0) { a.outOfRangeTicks = 0; mark(s, a); }
    const face = facingFromDelta(d.x - a.x, d.z - a.z);
    if (a.facing !== face) { a.facing = face; mark(s, a); }
    if (s.T < a.nextSwingTick) continue;

    const o = resolveSwing(
      { stance: a.stance as Stance, fightState: a.fightState as FightState },
      { stance: d.stance as Stance, fightState: d.fightState as FightState }
    );
    d.hp = Math.max(0, d.hp - o.damageToDefender);
    a.hp = Math.max(0, a.hp - o.damageToAttacker);
    a.fightState = o.attackerState;
    d.fightState = o.defenderState;
    a.lastExchangeTick = s.T;
    d.lastExchangeTick = s.T;
    a.nextSwingTick = s.T + SWING_INTERVAL_TICKS;

    let knockedBack = false;
    if (o.knockback) {
      const to = knockbackTile(d, a, s.blocked);
      if (to) { d.x = to.x; d.z = to.z; knockedBack = true; }
    }
    if (o.damageToDefender > 0) interrupt(s, d);
    if (o.damageToAttacker > 0) interrupt(s, a);

    emitEvent(s.ctx, {
      tick: s.T,
      kind: o.kind,
      attacker: a.identity,
      defender: d.identity,
      damage: o.kind === EventKind.Counter ? o.damageToAttacker : o.damageToDefender,
      attackerStance: a.stance,
      defenderStance: d.stance,
      attackerState: a.fightState,
      defenderState: d.fightState,
      defenderHp: d.hp,
    });
    if (knockedBack) {
      emitEvent(s.ctx, { tick: s.T, kind: EventKind.Knockback, attacker: a.identity, defender: d.identity, defenderHp: d.hp });
    }
    mark(s, a);
    mark(s, d);
  }
}

function phaseDecay(s: TickState): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (!alive(p) || p.fightState === FightState.Neutral) continue;
    const next = decayFightState(p.fightState as FightState, s.T - p.lastExchangeTick, p.outOfRangeTicks);
    if (next !== p.fightState) { p.fightState = next; mark(s, p); }
  }
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
    p.fightState = FightState.Neutral;
    p.outOfRangeTicks = 0;
    mark(s, p);

    for (const oh of s.order) {
      const q = s.players.get(oh)!;
      if (q.combatTarget && sameId(q.combatTarget, p.identity)) {
        q.combatTarget = undefined;
        q.hostile = false;
        q.fightState = FightState.Neutral;
        mark(s, q);
      }
    }
    emitEvent(s.ctx, { tick: s.T, kind: EventKind.Death, attacker: p.identity, defender: p.identity, defenderHp: 0 });
  }
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

    const players = new Map<string, PlayerRow>();
    for (const p of ctx.db.player.iter()) players.set(hex(p.identity), { ...p });
    const trees = new Map<number, TreeRow>();
    for (const t of ctx.db.tree.iter()) trees.set(t.id, { ...t });

    const s: TickState = {
      ctx,
      T,
      players,
      order: [...players.keys()].sort(),
      dirty: new Set(),
      trees,
      dirtyTrees: new Set(),
      blocked: blockedSetFromTiles(trees.values()),
    };

    phaseRespawn(s);
    phaseMovement(s);
    phaseHarvest(s);
    phaseSwings(s);
    phaseDecay(s);
    phaseDeath(s);
    phaseExpiry(s);

    ctx.db.world.id.update({ ...world, tick: T, tickStartedAt: ctx.timestamp });
    for (const h of s.dirty) ctx.db.player.identity.update(players.get(h)!);
    for (const id of s.dirtyTrees) ctx.db.tree.id.update(trees.get(id)!);
  }
);
