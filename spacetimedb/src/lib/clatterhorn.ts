import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import {
  BossEventKind, BossId, BossNoticeKind, CLATTERHORN_ID, CLATTER_CHALLENGER_CAP, CLATTER_DAMAGE, CLATTER_HOME, CLATTER_DRUM_EVERY, CLATTER_GLADE,
  CLATTER_REACH, CLATTER_REWARD, CLATTER_REWARDS_PER_TICK, ClatterAttack, ClatterState, Feat, HurtSource, Pending, PlayerState, RESPAWN_GRACE_TICKS, SWING_INTERVAL_TICKS,
  bfsPath, canonicalMiddle, chebyshev, clatterAttackable, clatterCanSwingFrom, clatterPhase, clatterQualifies, clatterReturnHome, clatterSwarmHit,
  clatterSwingGoal, facingFromDelta, freshClatterhorn, identityKey32, inBossRect, inGrace, inHotbar, stepClatterhorn, tileKey,
  type BossConfigLike, type ClatterCandidate,
} from '../../../shared/sim';
import { progress } from './adventure';
import type { BossTick } from './bossTick';
import { readSlots, giveItem } from './inventory';
import { hex } from './players';
import { unlockCosmetic } from './progress';
import { emitBossEvent, emitBossNotice, readBossConfig, sameRowShallow, u32 } from './rows';
import type { ClatterhornCreditRow, ClatterhornRow, Ctx, PlayerRow } from './types';

/**
 * Clatterhorn on the server (FINAL_SPEC 2, 5.3): one tick of payout batches,
 * players' swings, the pure step function, blows, runners and re-chase, with
 * at most one `clatterhorn` row write. Plus the owner's open/close/debug
 * effects. The AI itself lives in shared/sim/clatterhorn.ts.
 */

/** Insert the missing Clatterhorn row (Dormant when open, Closed otherwise). */
export function ensureClatterhorn(ctx: Ctx, cfg: BossConfigLike): ClatterhornRow {
  const row = ctx.db.clatterhorn.id.find(CLATTERHORN_ID);
  if (row) return row;
  return ctx.db.clatterhorn.insert({ id: CLATTERHORN_ID, ...freshClatterhorn(cfg) });
}

/** Grace that ends at a landed swing: inGrace(a, T + 1) is false afterwards. */
function endGrace(a: PlayerRow, T: number): void {
  a.respawnTick = Math.max(0, Math.min(a.respawnTick, T - RESPAWN_GRACE_TICKS));
}

const alive = (p: PlayerRow) => p.online && p.state === PlayerState.Alive;
const swingsAtBeetle = (p: PlayerRow) => p.pending === Pending.Clatterhorn && p.pendingId === BigInt(CLATTERHORN_ID) && !p.combatTarget;

/**
 * Pay one owed credit row: 2 gleamshell + 2 goldberries (overflow drops at the
 * player's tile), 40 Fighting XP, the horn keepsake, recipient-only notices;
 * then the row is deleted. The caller decrements `owedLeft`.
 */
function payCredit(ctx: Ctx, T: number, c: ClatterhornCreditRow, loaded?: PlayerRow): void {
  const p = loaded ?? ctx.db.player.identity.find(c.identity);
  if (p) {
    for (const item of CLATTER_REWARD.items) {
      giveItem(ctx, c.identity, item.itemId, item.quantity, p, T);
      emitBossNotice(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossNoticeKind.Reward, player: c.identity, itemId: item.itemId, quantity: item.quantity, x: p.x, z: p.z });
    }
    progress(ctx, c.identity, 3, CLATTER_REWARD.fightingXp, Feat.Protect);
    if (unlockCosmetic(ctx, c.identity, CLATTER_REWARD.keepsake)) {
      emitBossNotice(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossNoticeKind.Keepsake, player: c.identity, quantity: CLATTER_REWARD.keepsake });
    }
  }
  ctx.db.clatterhornCredit.identity.delete(c.identity);
}

/** Up to CLATTER_REWARDS_PER_TICK owed rows in identity order; returns how many were paid. */
function payBatch(t: BossTick): number {
  const owed: ClatterhornCreditRow[] = [];
  for (const c of t.ctx.db.clatterhornCredit.iter()) if (c.owed) owed.push(c);
  owed.sort((a, b) => (hex(a.identity) < hex(b.identity) ? -1 : hex(a.identity) > hex(b.identity) ? 1 : 0));
  const batch = owed.slice(0, CLATTER_REWARDS_PER_TICK);
  for (const c of batch) payCredit(t.ctx, t.T, c, t.players.get(hex(c.identity)));
  return batch.length;
}

/** Delete every credit row that is not waiting for a payout. */
function deleteUnowedCredit(ctx: Ctx): void {
  const gone: Identity[] = [];
  for (const c of ctx.db.clatterhornCredit.iter()) if (!c.owed) gone.push(c.identity);
  for (const id of gone) ctx.db.clatterhornCredit.identity.delete(id);
}

/** Blows and runners keep the swing loop; anything else queued (a harvest) stops. */
function hurt(t: BossTick, p: PlayerRow): void {
  if (p.pending !== Pending.Clatterhorn) t.interrupt(p);
  t.mark(p);
}

function damagePlayer(t: BossTick, p: PlayerRow, amount: number, source: number, half: number): void {
  p.hp = Math.max(0, p.hp - amount);
  hurt(t, p);
  emitBossNotice(t.ctx, {
    tick: t.T, boss: BossId.Clatterhorn, kind: BossNoticeKind.Hurt, player: p.identity, amount, hp: p.hp, half, quantity: source, x: p.x, z: p.z,
  });
}

/**
 * A swing took HP to 0 (FINAL_SPEC 2.8): qualifying credit becomes owed (the
 * rest is deleted), swingers stop, ClatterDefeat, then Burrowed at home.
 */
function defeat(t: BossTick, row: ClatterhornRow, cfg: BossConfigLike): ClatterhornRow {
  const { ctx, T } = t;
  let count = 0;
  for (const c of [...ctx.db.clatterhornCredit.iter()]) {
    if (c.owed) continue;  // an earlier fight's reward still waiting
    const p = t.players.get(hex(c.identity));
    if (p && p.online && clatterQualifies(c, row.fightCount, T)) {
      ctx.db.clatterhornCredit.identity.update({ ...c, owed: 1 });
      count++;
    } else {
      ctx.db.clatterhornCredit.identity.delete(c.identity);
    }
  }
  for (const h of t.order) {
    const p = t.players.get(h)!;
    if (p.pending !== Pending.Clatterhorn) continue;
    p.pending = Pending.None; p.pendingId = 0n;
    p.targetX = undefined; p.targetZ = undefined;
    t.mark(p);
  }
  emitBossEvent(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterDefeat, quantity: count, x: row.x, z: row.z });
  // Home with every attack field cleared (no stale runners or telegraph while burrowed).
  return {
    ...clatterReturnHome(row, cfg, ClatterState.Burrowed),
    hp: 0, stateUntilTick: T + 300, defeats: row.defeats + 1, owedLeft: u32(row.owedLeft + count),
  };
}

/** One tick of Clatterhorn: payout batches, swings, the step function, blows, runners, re-chase, one row write. */
export function phaseClatterhorn(t: BossTick): void {
  const { ctx, T } = t;
  if (!ctx.db.clatterhorn || !ctx.db.bossConfig) return;
  const cfg = readBossConfig(ctx);
  const found = ctx.db.clatterhorn.id.find(CLATTERHORN_ID);
  // Closed and never opened: nothing to read or write (a missing row reads as Closed).
  if (!found && !cfg.clatterhornOpen) return;
  const original = found ?? ensureClatterhorn(ctx, cfg);
  let row: ClatterhornRow = original;
  const write = () => { if (!sameRowShallow(original, row)) ctx.db.clatterhorn.id.update(row); };

  // 1. Payout batches (any state, Closed included).
  if (row.owedLeft > 0) {
    const paid = payBatch(t);
    row = { ...row, owedLeft: paid === 0 ? 0 : Math.max(0, row.owedLeft - paid) };
  }

  // 2. Nothing else while closed or burrowed (Dormant continues: its step needs the candidates).
  if (row.state === ClatterState.Closed || (row.state === ClatterState.Burrowed && T < row.stateUntilTick)) { write(); return; }

  // Grace as of the top of this phase: a swing that ends grace makes its attacker hittable from the next tick on.
  const graced = new Set<string>();
  for (const h of t.order) { const p = t.players.get(h)!; if (alive(p) && inGrace(p, T)) graced.add(h); }

  // 3. Swings (phaseGiant's loop, reach 2 from a glade tile, x2 while Flipped).
  const attackable = clatterAttackable(row);
  for (const h of t.order) {
    const a = t.players.get(h)!;
    if (!alive(a) || !swingsAtBeetle(a) || !clatterCanSwingFrom(a, row)) continue;
    if (a.x !== row.x || a.z !== row.z) {
      const face = facingFromDelta(row.x - a.x, row.z - a.z);
      if (a.facing !== face) { a.facing = face; t.mark(a); }
    }
    if (T < a.nextSwingTick) continue;
    if (!attackable) {
      // A due swing at a sleeping beetle ends grace, so the swinger counts as a candidate and wakes it.
      if (row.state === ClatterState.Dormant && graced.has(h)) { endGrace(a, T); graced.delete(h); t.mark(a); }
      continue;
    }
    if (a.weapon !== '' && !inHotbar(readSlots(ctx, a.identity).slots, a.weapon)) a.weapon = '';
    let damage = t.combatDamage(a);
    if (row.state === ClatterState.Flipped) damage *= 2;

    const prev = ctx.db.clatterhornCredit.identity.find(a.identity);
    let credit: ClatterhornCreditRow;
    if (prev && prev.fight === row.fightCount && !prev.owed) {
      credit = { ...prev, damage: u32(prev.damage + damage), lastHitTick: T };
      ctx.db.clatterhornCredit.identity.update(credit);
    } else {
      if (prev?.owed) {
        // An older fight's reward is still queued: pay it now so the new fight's row can take its place.
        payCredit(ctx, T, prev, a);
        row = { ...row, owedLeft: Math.max(0, row.owedLeft - 1) };
      }
      credit = { identity: a.identity, fight: row.fightCount, damage, lastHitTick: T, owed: 0 };
      if (prev && !prev.owed) ctx.db.clatterhornCredit.identity.update(credit); else ctx.db.clatterhornCredit.insert(credit);
      if (row.challengers < CLATTER_CHALLENGER_CAP) {
        const grow = cfg.clatterHpPerChallenger;
        row = { ...row, challengers: row.challengers + 1, maxHp: u32(row.maxHp + grow), hp: u32(row.hp + grow) };
      }
    }
    row = { ...row, hp: Math.max(0, row.hp - damage), lastHitTick: T };
    a.nextSwingTick = T + SWING_INTERVAL_TICKS;
    endGrace(a, T);
    t.mark(a);
    emitBossNotice(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossNoticeKind.YouHit, player: a.identity, amount: damage, total: credit.damage, x: row.x, z: row.z });
    if (row.hp === 0) { row = defeat(t, row, cfg); write(); return; }
  }

  // 4. Candidates: loaded, alive, not in grace, inside the glade.
  const cands: ClatterCandidate[] = [];
  t.order.forEach((h, order) => {
    const p = t.players.get(h)!;
    if (alive(p) && !graced.has(h) && inBossRect(p, CLATTER_GLADE)) cands.push({ x: p.x, z: p.z, order, key: identityKey32(h) });
  });

  // 5. The AI.
  const step = stepClatterhorn(row, T, cands, cfg);
  if (step.next) row = step.next;

  // 6. A charge or spin lands on end-of-movement tiles.
  if (step.blow) {
    const b = step.blow;
    const source = b.attack === ClatterAttack.Spin ? HurtSource.Spin : HurtSource.Charge;
    for (const h of t.order) {
      const p = t.players.get(h)!;
      if (!alive(p) || graced.has(h) || !b.tiles.has(tileKey(p))) continue;
      damagePlayer(t, p, b.damage, source, 2);
    }
  }

  // 7. Runners: swept collision from the start-of-tick tile through the canonical middle.
  if (row.swarmTick > 0 && row.swarmTick < T && T <= row.swarmTick + 21) {
    for (const h of t.order) {
      const p = t.players.get(h)!;
      if (!alive(p) || graced.has(h) || p.hp <= 0) continue;
      const p0 = t.before.get(h) ?? p;
      if (!inBossRect(p0, CLATTER_GLADE) && !inBossRect(p, CLATTER_GLADE)) continue;
      const p1 = canonicalMiddle(p0, p, t.blocked);
      const half = clatterSwarmHit(row, T, p0, p1, p);
      if (half) damagePlayer(t, p, CLATTER_DAMAGE.runner, HurtSource.Runner, half);
    }
  }

  // 8. Re-chase: swingers left out of reach by a charge walk to the new centre (one BFS each per relocation),
  // and a swinger standing idle in reach but outside the glade walks in (it cannot land swings from there).
  for (const h of t.order) {
    const p = t.players.get(h)!;
    if (!alive(p) || !swingsAtBeetle(p)) continue;
    if (!step.moved && (p.targetX !== undefined || chebyshev(p, row) > CLATTER_REACH)) continue;
    if (clatterCanSwingFrom(p, row)) {
      // Already in reach of the new centre: drop a walk target aimed at the old one.
      if (p.targetX !== undefined) { p.targetX = undefined; p.targetZ = undefined; t.mark(p); }
      continue;
    }
    const path = bfsPath(p, clatterSwingGoal(row, t.blocked), t.blocked, t.enterRule(p));
    if (path && path.length > 0) {
      const end = path[path.length - 1];
      p.targetX = end.x; p.targetZ = end.z;
    } else if (!path) {
      p.pending = Pending.None; p.pendingId = 0n;
      p.targetX = undefined; p.targetZ = undefined;
    }
    t.mark(p);
  }

  // 9. World-visible moments.
  const at = { x: row.x, z: row.z };
  if (step.woke) emitBossEvent(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterWake, quantity: cands.length, ...at });
  if (step.returned) emitBossEvent(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterRespawn, ...at });
  if (step.reset) {
    deleteUnowedCredit(ctx);
    emitBossEvent(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterReset, ...at });
  }

  // 10. One row write.
  write();
}

// ---- Owner effects (configure_bosses, boss_debug) ------------------------------------

/** Every player row still walking to or swinging at the beetle stops (direct writes; reducers only). */
function dropAllSwingers(ctx: Ctx): void {
  const swingers: PlayerRow[] = [];
  for (const p of ctx.db.player.iter()) if (p.pending === Pending.Clatterhorn) swingers.push(p);
  for (const p of swingers) {
    ctx.db.player.identity.update({ ...p, pending: Pending.None, pendingId: 0n, targetX: undefined, targetZ: undefined });
  }
}

/** Owner close: state Closed, drop every `pending == 6` by direct writes, delete non-owed credit. */
export function clatterClose(ctx: Ctx, T: number): void {
  void T;
  const row = ctx.db.clatterhorn.id.find(CLATTERHORN_ID);
  if (row && row.state !== ClatterState.Closed) {
    // fightCount, defeats and owedLeft stay: owed rewards keep paying while closed.
    ctx.db.clatterhorn.id.update(clatterReturnHome(row, readBossConfig(ctx), ClatterState.Closed));
  }
  dropAllSwingers(ctx);
  deleteUnowedCredit(ctx);
}

/** Owner reopen: Dormant at home with hp = maxHp = clatterHpBase; fightCount, defeats and owedLeft kept. */
export function clatterOpen(ctx: Ctx, T: number, cfg: BossConfigLike): void {
  void T;
  const row = ctx.db.clatterhorn.id.find(CLATTERHORN_ID);
  if (!row) { ensureClatterhorn(ctx, { ...cfg, clatterhornOpen: true }); return; }
  if (row.state === ClatterState.Closed) ctx.db.clatterhorn.id.update(clatterReturnHome(row, cfg));
}

/** Owner debug ops for live checks: clatter_wake, clatter_respawn, clatter_hp, clatter_drum. */
export function clatterDebug(ctx: Ctx, T: number, op: string, value: number): void {
  const cfg = readBossConfig(ctx);
  const row = ctx.db.clatterhorn.id.find(CLATTERHORN_ID);
  if (!row || row.state === ClatterState.Closed || !cfg.clatterhornOpen) throw new SenderError('The glade is quiet: Clatterhorn is away');
  const at = { x: CLATTER_HOME.x, z: CLATTER_HOME.z };
  switch (op) {
    case 'clatter_wake': {
      if (row.state !== ClatterState.Dormant) throw new SenderError('The beetle is already awake');
      // The step's own wake transition, with a stand-in candidate at home.
      const step = stepClatterhorn(row, T, [{ ...at, order: 0, key: 1 }], cfg);
      ctx.db.clatterhorn.id.update(step.next!);
      let n = 0;
      for (const p of ctx.db.player.iter()) {
        if (alive(p) && (p.region || 'bramblewild') === 'bramblewild' && inBossRect(p, CLATTER_GLADE) && !inGrace(p, T)) n++;
      }
      emitBossEvent(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterWake, quantity: Math.max(1, n), ...at });
      return;
    }
    case 'clatter_respawn': {
      if (row.state !== ClatterState.Burrowed) throw new SenderError('The beetle is not burrowed');
      ctx.db.clatterhorn.id.update(clatterReturnHome(row, cfg));
      emitBossEvent(ctx, { tick: T, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterRespawn, ...at });
      return;
    }
    case 'clatter_hp': {
      if (!clatterAttackable(row)) throw new SenderError('The beetle is not fighting');
      const hp = Math.min(row.maxHp, Math.max(1, Math.floor((row.maxHp * value) / 100)));
      ctx.db.clatterhorn.id.update({ ...row, hp });
      return;
    }
    case 'clatter_drum': {
      if (!clatterAttackable(row)) throw new SenderError('The beetle is not fighting');
      // Phase 2 at least, and the action count one short of the next Drum slot of the effective phase.
      const raised = { ...row, phase: Math.max(row.phase, 2) };
      const every = CLATTER_DRUM_EVERY[clatterPhase(raised, T)];
      const attackCount = row.attackCount + ((every - 1 - (row.attackCount % every)) + every) % every;
      ctx.db.clatterhorn.id.update({ ...raised, attackCount });
      return;
    }
    default:
      throw new SenderError('This debug action does not exist');
  }
}
