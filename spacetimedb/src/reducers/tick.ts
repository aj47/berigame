import { isHomeTarget } from "../../../shared/sim/frontier/homeMap";
import { tickFrontier, frontierRepository, projectFrontier } from '../lib/frontier';
import { damage as frontierDamage } from '../../../shared/sim/frontier/engine';
import { reconcileTerrain } from '../lib/terrain';
import { carrying, profile, saveProfile, progress, tickExpeditions, tickDuels, duelFor } from '../lib/adventure';
import { canFindStick, Feat, cargoMovementSteps } from '../../../shared/sim';
import { SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { tickSchedule } from '../tables';
import {
  DEATH_TICKS, EventKind, MELEE_RANGE, isBerryNode, Cosmetic, areaOf, harvestXp, skillForNode, regrowTicksFor, Pending, PlayerState, SPAWN_TILE,
  MOVEMENT_STEPS_PER_TICK, STICK_ITEM_ID, SWING_INTERVAL_TICKS,
  bfsPath, chebyshev, facingFromDelta, goalAdjacentTo,
  goalIsTile, holdsItem, inGrace, inHotbar, inSafeRing, isNewcomer,
  neighbors8, swingDamage, tileKey, DUMMY_TILE, dummyAfterHit, worldBlockedSet,
  TRADE_BREAK_RANGE, TRADE_REQUEST_TICKS, TRADE_RANGE, SocialNotice,
  GIANT_ID, GIANT_REACH, GIANT_TILE, GiantEventKind, GiantState, giantAfterHit, giantForgot,
  inBoulders, stepGiant, type GiantCandidate,
  RAID_REWARD, RaidOutcome, raidDue, raidRewardees,
} from '../../../shared/sim';
import { emitGiantEvent, ensureGiant } from '../lib/giant';
import { clearContributions as clearAllContributions, countRaiders, ensureRaid, nowMs, sleepGiant, wakeGiant } from '../lib/raid';
import { mentorMilestone } from '../lib/mentor';
import { ensureDummy } from '../lib/dummy';
import { playerEnterRule } from '../lib/brambles';
import { emitEvent } from '../lib/events';
import { seedMissingNodes } from '../lib/nodes';
import { statsDeath, statsPosition } from '../lib/stats';
import { dropOnGround, giveItem, readSlots, takeGroundItem } from '../lib/inventory';
import { clearInteractions, hex, sameId } from '../lib/players';
import { canPlay } from '../lib/access';
import { cancelTrade, notify } from '../lib/social';
import { requestTradeInRange, tradePartnerProblem } from '../lib/trade';
import { grantXp, harvestTicksForPlayer, unlockCosmetic } from '../lib/progress';
import type { Ctx, GiantRow, PlayerRow, TrainingDummyRow, TreeRow } from '../lib/types';
import { MentorMilestone, bossNoPvpZone, inSpireFloor } from '../../../shared/sim';
import { phaseClatterhorn } from '../lib/clatterhorn';
import { phaseSpire } from '../lib/spire';
import type { BossTick } from '../lib/bossTick';

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

/** Damage interrupts gathering and queued interactions. */
function interrupt(s: TickState, p: PlayerRow): void {
  if (p.harvestTreeId !== 0 || p.pending !== Pending.None) {
    releaseTreeInTick(s, p);
    if (p.pending === Pending.Trade) {
      p.combatTarget = undefined;
      p.targetX = undefined; p.targetZ = undefined;
      notify(s.ctx, p.identity, p.identity, SocialNotice.Info, 'Trade approach cancelled: you were hit');
    }
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
  p.harvestEndTick = s.T + harvestTicksForPlayer(s.ctx, p.identity, tree);
  return true;
}

/** Stop the approach without leaving an ordinary follow action behind. */
function stopTradeApproach(s: TickState, p: PlayerRow, reason?: string): void {
  p.pending = Pending.None; p.pendingId = 0n;
  p.combatTarget = undefined; p.hostile = false;
  p.targetX = undefined; p.targetZ = undefined;
  mark(s, p);
  if (reason) notify(s.ctx, p.identity, p.identity, SocialNotice.Info, reason);
}

function resolvePending(s: TickState, p: PlayerRow): void {
  if (p.pending === Pending.Trade) {
    const other = p.combatTarget ? s.players.get(hex(p.combatTarget)) : undefined;
    const problem = tradePartnerProblem(s.ctx, p, other);
    if (problem) { stopTradeApproach(s, p, problem); return; }
  } else if (p.pending === Pending.Harvest) {
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
  } else if (p.pending === Pending.Giant) {
    // Stop at the first tile touching its footprint; phaseGiant swings.
    if (chebyshev(p, GIANT_TILE) <= GIANT_REACH && p.targetX !== undefined) {
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
      if (taken > 0 && item.itemId === STICK_ITEM_ID) unlockCosmetic(s.ctx, p.identity, Cosmetic.StrawHat);
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
    if (p.targetX !== undefined && isHomeTarget({ x: p.targetX, z: p.targetZ! })) continue;
    if (p.pending === Pending.Trade) {
      resolvePending(s, p);
      if (!p.combatTarget) continue;
    }

    let goal: ((t: { x: number; z: number }) => boolean) | null = null;
    if (p.combatTarget) {
      const tgt = s.players.get(hex(p.combatTarget));
      if (!tgt || !alive(tgt)) {
        p.combatTarget = undefined;
        p.hostile = false;
        mark(s, p);
      } else {
        const range = p.pending === Pending.Trade ? TRADE_RANGE : MELEE_RANGE;
        if (chebyshev(p, tgt) > range) goal = goalAdjacentTo(tgt, s.blocked, range);
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
      // One-way brambles and boulder line. Recomputed every tick, so dropping the
      // key mid-route makes the path fail and the player stops where they are.
      const path = bfsPath(p, goal, s.blocked, playerEnterRule(s.ctx, p));
      if (!path || path.length === 0) {
        if (p.pending === Pending.Trade) {
          stopTradeApproach(s, p, 'Cannot reach them to trade');
          continue;
        }
        if (!p.combatTarget) { p.targetX = undefined; p.targetZ = undefined; }
        if (p.pending !== Pending.None) { p.pending = Pending.None; p.pendingId = 0n; }
        mark(s, p);
      } else {
        // Milestone cosmetic: the step from the hedge onto the Coast (rare; one PK lookup when it happens).
        const fromArea = areaOf(p);
        for (const step of path.slice(0, cargoMovementSteps(carrying(s.ctx, p.identity)))) {
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
            if (p.pending === Pending.None || (!p.combatTarget && p.targetX === undefined)) break;
          }
        }
        if ((fromArea === 'grove' || fromArea === 'hedge') && areaOf(p) === 'coast' && unlockCosmetic(s.ctx, p.identity, Cosmetic.CoastScarf)) {
          mentorMilestone(s.ctx, p, MentorMilestone.Coast);
        }
      }
    }

    if (p.pending !== Pending.None) resolvePending(s, p);
  }
}

/** Check arrival after everyone moves, so a moving partner cannot create an out-of-range request. */
function phaseTradeApproaches(s: TickState): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (!alive(p) || p.pending !== Pending.Trade) continue;
    const other = p.combatTarget ? s.players.get(hex(p.combatTarget)) : undefined;
    const problem = tradePartnerProblem(s.ctx, p, other);
    if (problem) { stopTradeApproach(s, p, problem); continue; }
    if (chebyshev(p, other!) <= TRADE_RANGE) {
      stopTradeApproach(s, p);
      requestTradeInRange(s.ctx, p, other!, s.T);
    }
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
      // Draw on every berry harvest; level 2 guarantees the first stick, then allows spares.
      // Only berry trees find sticks: Coast nodes never draw.
      const berry = isBerryNode(tree);
      const roll = berry ? s.ctx.random() : 1;
      const level = grantXp(s.ctx, p.identity, skillForNode(tree.kind), harvestXp(tree.kind));
      const pp = profile(s.ctx, p.identity);
      if (berry && canFindStick(level, pp.stickClaimed, roll)) {
        saveProfile(s.ctx, { ...pp, stickClaimed: true });
        giveItem(s.ctx, p.identity, STICK_ITEM_ID, 1, p, s.T);
        // A find ends first-spawn grace: 10 more ticks to wield it and step back.
        if (p.respawnTick > s.T) p.respawnTick = s.T;
        emitEvent(s.ctx, { tick: s.T, kind: EventKind.ItemFound, attacker: p.identity, defender: p.identity, itemId: STICK_ITEM_ID, defenderHp: p.hp });
        unlockCosmetic(s.ctx, p.identity, Cosmetic.StrawHat);
      }
      // F2: one XP write per finished harvest (Foraging for berries, Beachcombing on the Coast).
      p.harvestTreeId = 0;
      p.harvestEndTick = 0;
    } else {
      releaseTreeInTick(s, p);
    }
    mark(s, p);
  }
}

function combatDamage(s: TickState, a: PlayerRow): number {
  const repo = frontierRepository(s.ctx), p = repo.get('profile', hex(a.identity));
  if (!p || !repo.get('config', 'world')?.enabled) return swingDamage(a.weapon);
  const result = frontierDamage(p, { weapon: a.weapon } as any);
  repo.put('profile', p); projectFrontier(s.ctx, repo);
  return result;
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
    if (duelFor(s.ctx, a.identity) || duelFor(s.ctx, d.identity)) continue;
    // No PvP inside the Sunken Spire, in Clatterhorn's Glade or at the Spire Gate (bossNoPvpZone covers the floor):
    // the attacker keeps its target and swings once both leave.
    if (bossNoPvpZone(a) || bossNoPvpZone(d)) continue;
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
    const damage = combatDamage(s, a);
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
    const damage = combatDamage(s, a);
    const { hp, reset } = dummyAfterHit(dummy, damage, s.T);
    if (reset) progress(s.ctx, a.identity, 3, 12, Feat.Protect);
    dummy.hp = hp;
    dummy.lastHitTick = s.T;
    dirty = true;
    a.nextSwingTick = s.T + SWING_INTERVAL_TICKS;
    s.ctx.db.dummyEvent.insert({ tick: s.T, dummyId: dummy.id, attacker: a.identity, damage, itemId: a.weapon, hp, reset });
    mark(s, a);
  }
  if (dummy && dirty) s.ctx.db.trainingDummy.id.update(dummy);
}

/** Damage each player dealt this life; the private table is tiny (the fighters of one Giant). */
function addContribution(s: TickState, a: PlayerRow, giantId: number, damage: number): void {
  const row = s.ctx.db.giantContribution.identity.find(a.identity);
  if (!row) s.ctx.db.giantContribution.insert({ identity: a.identity, giantId, damage, lastHitTick: s.T });
  else if (row.giantId !== giantId) s.ctx.db.giantContribution.identity.update({ ...row, giantId, damage, lastHitTick: s.T });
  else s.ctx.db.giantContribution.identity.update({ ...row, damage: row.damage + damage, lastHitTick: s.T });
}

function clearContributions(s: TickState): void {
  clearAllContributions(s.ctx);
}

/** Nobody keeps walking to or swinging at a Giant that fell asleep. */
function dropGiantTargets(s: TickState, giantId: number): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    if (p.pending === Pending.Giant && Number(p.pendingId) === giantId) {
      p.pending = Pending.None; p.pendingId = 0n;
      p.targetX = undefined; p.targetZ = undefined;
      mark(s, p);
    }
  }
}

/**
 * The raid Giant falls: equal rewards (obsidian and the Giant's Tooth
 * keepsake) for every online contributor who dealt enough this raid, then it
 * goes back to sleep until the next scheduled wake.
 */
function defeatGiant(s: TickState, g: GiantRow): void {
  const rows = [...s.ctx.db.giantContribution.iter()].filter((c) => c.giantId === g.id);
  for (const c of raidRewardees(rows)) {
    const p = s.players.get(hex(c.identity));
    if (!p || !p.online) continue;
    giveItem(s.ctx, p.identity, RAID_REWARD.itemId, RAID_REWARD.quantity, p, s.T);
    unlockCosmetic(s.ctx, p.identity, Cosmetic.GiantsTooth);
    emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.Reward, player: p.identity, itemId: RAID_REWARD.itemId, quantity: RAID_REWARD.quantity, damage: c.damage, x: p.x, z: p.z });
  }
  dropGiantTargets(s, g.id);
  emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.Defeat, x: g.x, z: g.z });
  sleepGiant(s.ctx, s.T, g, RaidOutcome.Defeated);
}

/**
 * F3: the Giant, on the raid schedule (shared/sim/raid.ts). Asleep, this is
 * one primary-key read of the raid row and a time compare: no writes except
 * the T-10/T-1 announcements and the wake. Awake: players' swings first (a
 * blow that floors it cancels its attack), then its AI (stepGiant):
 * telegraph, blow, recover. The giant row is written only on a change.
 */
function phaseGiant(s: TickState): void {
  const raid = ensureRaid(s.ctx, s.T);
  const due = raidDue(raid, nowMs(s.ctx));
  if (due.kind === 'announce') {
    s.ctx.db.giantRaid.id.update({ ...raid, announced: due.announced });
    emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.Announce, quantity: due.minutes, x: GIANT_TILE.x, z: GIANT_TILE.z });
    return;
  }
  if (due.kind === 'missed') {
    const g = s.ctx.db.giant.id.find(GIANT_ID) ?? ensureGiant(s.ctx, s.T);
    sleepGiant(s.ctx, s.T, g, raid.lastOutcome as RaidOutcome);
    return;
  }
  if (due.kind === 'wake') {
    wakeGiant(s.ctx, s.T, countRaiders(s.players.values()));
    return;
  }
  if (!raid.awake) return;

  const row = s.ctx.db.giant.id.find(GIANT_ID) ?? ensureGiant(s.ctx, s.T);
  if (due.kind === 'sleep') {
    dropGiantTargets(s, row.id);
    sleepGiant(s.ctx, s.T, row, RaidOutcome.Slept);
    return;
  }
  let g: GiantRow = row;
  let dirty = false;

  for (const h of s.order) {
    const a = s.players.get(h)!;
    if (!alive(a) || a.pending !== Pending.Giant || a.combatTarget || Number(a.pendingId) !== g.id) continue;
    if (chebyshev(a, g) > GIANT_REACH) continue;
    const face = facingFromDelta(g.x - a.x, g.z - a.z);
    if (a.facing !== face) { a.facing = face; mark(s, a); }
    if (s.T < a.nextSwingTick) continue;
    if (a.weapon !== '' && !inHotbar(readSlots(s.ctx, a.identity).slots, a.weapon)) a.weapon = '';
    // It regenerated since the last blow: old contributions no longer count.
    if (giantForgot(g, s.T)) clearContributions(s);
    const damage = combatDamage(s, a);
    const { hp, defeated } = giantAfterHit(g, damage, s.T);
    g = { ...g, hp, lastHitTick: s.T };
    dirty = true;
    a.nextSwingTick = s.T + SWING_INTERVAL_TICKS;
    mark(s, a);
    addContribution(s, a, g.id, damage);
    emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.Hit, player: a.identity, damage, itemId: a.weapon, hp, x: a.x, z: a.z });
    if (defeated) { defeatGiant(s, g); return; }
  }

  const candidates: GiantCandidate[] = [];
  s.order.forEach((h, order) => {
    const p = s.players.get(h)!;
    if (alive(p) && inBoulders(p) && !inGrace(p, s.T)) candidates.push({ x: p.x, z: p.z, order });
  });
  const step = stepGiant(g, s.T, candidates);
  if (step.next) { g = step.next; dirty = true; }
  if (step.windup) emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.Windup, quantity: g.attack, x: g.slamX, z: g.slamZ });
  if (step.blow) {
    const b = step.blow;
    for (const h of s.order) {
      const p = s.players.get(h)!;
      if (!alive(p) || inGrace(p, s.T) || chebyshev(p, b) > b.radius) continue;
      p.hp = Math.max(0, p.hp - b.damage);
      interrupt(s, p);
      mark(s, p);
      emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.PlayerHit, player: p.identity, damage: b.damage, hp: p.hp, x: p.x, z: p.z });
    }
    emitGiantEvent(s.ctx, { tick: s.T, kind: GiantEventKind.Slam, quantity: b.attack, damage: b.damage, x: b.x, z: b.z });
  }
  if (dirty && !sameRow(row, g)) s.ctx.db.giant.id.update(g);
}

function phaseDeath(s: TickState): void {
  for (const h of s.order) {
    const p = s.players.get(h)!;
    // Safety net: nobody dies (or drops a bag) on the Spire floor; phaseSpire knocks out and ejects instead.
    if (inSpireFloor(p)) continue;
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

/**
 * Trades end when a side leaves, dies, walks away (beyond TRADE_BREAK_RANGE)
 * or leaves a request unanswered. Reads only the (tiny) trade table; writes
 * only when a trade ends.
 */
function phaseTrades(s: TickState): void {
  const table = s.ctx.db.trade;
  if (!table || table.count() === 0n) return;
  for (const row of [...table.iter()]) {
    const a = s.players.get(hex(row.a)) ?? s.ctx.db.player.identity.find(row.a);
    const b = s.players.get(hex(row.b)) ?? s.ctx.db.player.identity.find(row.b);
    let reason: string | null = null;
    if (!a || !b || !a.online || !b.online) reason = 'Trade cancelled: they left';
    else if (a.state !== PlayerState.Alive || b.state !== PlayerState.Alive) reason = 'Trade cancelled';
    else if ((a.region || 'bramblewild') !== (b.region || 'bramblewild') || chebyshev(a, b) > TRADE_BREAK_RANGE) reason = 'Trade cancelled: you walked too far apart';
    else if (!row.accepted && s.T - row.createdTick > TRADE_REQUEST_TICKS) reason = 'Trade request expired';
    if (reason) cancelTrade(s.ctx, row, reason);
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

    seedMissingNodes(ctx);
    reconcileTerrain(ctx);

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
      if (player.region && player.region !== 'bramblewild') continue;
      if (!player.online && player.state !== PlayerState.Dead && player.combatTarget === undefined) continue;
      const h = hex(player.identity);
      original.set(h, player);
      players.set(h, { ...player });
    }
    const trees = new Map<number, TreeRow>();
    const originalTrees = new Map<number, TreeRow>();
    for (const t of ctx.db.tree.iter()) { originalTrees.set(t.id, t); trees.set(t.id, { ...t }); }
    // Coast nodes: seed any missing id (a database published before M2). Idempotent.

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

    // The boss phases' view of this tick (lib/bossTick.ts).
    const api: BossTick = {
      ctx, T, players: s.players, order: s.order, before: original, blocked: s.blocked,
      mark: (p) => mark(s, p), interrupt: (p) => interrupt(s, p), combatDamage: (p) => combatDamage(s, p),
      enterRule: (p) => playerEnterRule(ctx, p),
    };

    phaseRespawn(s);
    phaseMovement(s);
    phaseTradeApproaches(s);
    phaseHarvest(s);
    phaseSwings(s);
    phaseDummySwings(s);
    phaseGiant(s);
    phaseClatterhorn(api);   // after the Giant, before death: lethal blows resolve this tick
    phaseSpire(api);         // lobbies, runs (swings, stars, bullets, knockouts), cleanup, the stranded sweep
    phaseDeath(s);
    phaseTrades(s);
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
    tickExpeditions(ctx, T);
    tickDuels(ctx, T);
    tickFrontier(ctx);
  }
);
