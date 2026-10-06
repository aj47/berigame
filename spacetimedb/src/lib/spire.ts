import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import {
  BossEventKind, BossId, BossNoticeKind, Feat, HurtSource, Pending, PlayerState, RESPAWN_GRACE_TICKS, SPIRE_AWAY_TICKS,
  SPIRE_END_LINGER, SPIRE_EXIT, SPIRE_INTRO_TICKS, SPIRE_KEY_ITEM_ID, SPIRE_KO_HP, SPIRE_NONE, SPIRE_REWARD,
  SPIRE_RULES_VERSION, SPIRE_SPAWNS, SPIRE_STAR_DAMAGE, SPIRE_TIME_LIMIT, SocialNotice, SpireMemberState, SpireMode,
  SpireOutcome, SpireStage, inHotbar, inSpireCourt, spireBulletDamage, spireEnraged, spireFightBullets, spireFlawless,
  spireHitsMove, spireImmune, spireMaxHp, spireMemberBump, spireMiddle, spireNextPattern, spirePatternDue,
  spireQualifies, spireSeed, spireSlot, spireStarWave, spireStars, spireSwingDue, swingDamage, withSpireSlot,
  type Tile,
} from '../../../shared/sim';
import { progress, spend } from './adventure';
import type { BossTick } from './bossTick';
import { giveItem, readSlots } from './inventory';
import { clearInteractions, hex } from './players';
import { unlockCosmetic } from './progress';
import { emitBossEvent, emitBossNotice, readBossConfig, sameRowShallow } from './rows';
import { cancelTrade, notify, tradesOf } from './social';
import { onSpireFloor } from './spireGuards';
import type { Ctx, PlayerRow, SpireFightRow, SpireMemberRow, SpireRunRow } from './types';

/**
 * The Sunken Spire on the server (FINAL_SPEC 3.3, 3.10, 5.4; CORE_SCOPE: no
 * practice, private lobbies, kick, queue or downed state).
 *
 * Every run shares the one sealed floor; each has its own run, member and
 * fight rows, and bullets, stars and swings only ever touch that run. A
 * member whose HP reaches 0 is knocked out at once: ejected to the gate exit
 * with 10 HP and 10 ticks of grace, bag untouched, state Out.
 *
 * Player rows: inside the tick, loaded players are the tick's working copies
 * (mutated and `mark`ed); anyone else is written directly, so the tick's
 * write-back never clobbers it. Reducers write every row directly.
 */

const SPIRE_CLOSED_MESSAGE = 'The Sunken Spire was sealed; your party broke up';
const SPIRE_UPDATED_MESSAGE = 'The Spire was updated: open a new party';
const SPIRE_BROKE_UP_MESSAGE = 'The Spire party broke up';

/** How the Spire reads and writes player rows in the current transaction. */
interface PlayerIo {
  get(id: Identity): PlayerRow | undefined;
  save(p: PlayerRow): void;
}

/** Reducers: copies of the stored rows, written straight back. */
function directIo(ctx: Ctx): PlayerIo {
  return {
    get: (id) => { const row = ctx.db.player.identity.find(id); return row ? { ...row } : undefined; },
    save: (p) => ctx.db.player.identity.update(p),
  };
}

/** The tick: working copies for loaded players (`mark`), direct writes for everyone else. */
function tickIo(t: BossTick): PlayerIo {
  return {
    get: (id) => {
      const loaded = t.players.get(hex(id));
      if (loaded) return loaded;
      const row = t.ctx.db.player.identity.find(id);
      return row ? { ...row } : undefined;
    },
    save: (p) => {
      if (t.players.get(hex(p.identity)) === p) t.mark(p);
      else t.ctx.db.player.identity.update(p);
    },
  };
}

/** Online, alive and standing on the floor. */
function present(p: PlayerRow | undefined): p is PlayerRow {
  return !!p && p.online && p.state === PlayerState.Alive && onSpireFloor(p);
}

/**
 * The eject (section 3.3): to SPIRE_EXIT with targets and interactions cleared and
 * 10 ticks of grace. The bag is never touched. Mutates `p`.
 */
function spireEject(p: PlayerRow, hp: number, T: number): void {
  p.x = SPIRE_EXIT.x; p.z = SPIRE_EXIT.z;
  p.targetX = undefined; p.targetZ = undefined;
  p.pending = Pending.None; p.pendingId = 0n;
  p.combatTarget = undefined; p.hostile = false;
  p.respawnTick = T;
  p.hp = Math.max(1, Math.min(255, Math.floor(hp)));
}

/** Ejects a member's player if it still stands on the floor. */
function ejectMember(io: PlayerIo, id: Identity, T: number, hp: (p: PlayerRow) => number): PlayerRow | undefined {
  const p = io.get(id);
  if (!p) return undefined;
  if (onSpireFloor(p)) { spireEject(p, hp(p), T); io.save(p); }
  return p;
}

function membersOf(ctx: Ctx, runId: bigint): SpireMemberRow[] {
  return [...ctx.db.spireMember.runId.filter(runId)].sort((a, b) => a.slot - b.slot);
}

function writeMember(ctx: Ctx, m: SpireMemberRow): void {
  ctx.db.spireMember.identity.update(m);
}

function notifyMembers(ctx: Ctx, members: readonly SpireMemberRow[], text: string): void {
  for (const m of members) notify(ctx, m.identity, m.identity, SocialNotice.Info, text);
}

/** Deletes a Lobby/Queued run and its member rows, telling each member why. */
function dissolveLobby(ctx: Ctx, run: SpireRunRow, text: string): void {
  const members = membersOf(ctx, run.id);
  for (const m of members) ctx.db.spireMember.identity.delete(m.identity);
  ctx.db.spireRun.id.delete(run.id);
  notifyMembers(ctx, members, text);
}

/** The run, its fight row and every member row (the 20-tick linger is over). */
function deleteRun(ctx: Ctx, runId: bigint): void {
  for (const m of membersOf(ctx, runId)) ctx.db.spireMember.identity.delete(m.identity);
  if (ctx.db.spireFight.runId.find(runId)) ctx.db.spireFight.runId.delete(runId);
  ctx.db.spireRun.id.delete(runId);
}

function resultNotice(ctx: Ctx, T: number, run: SpireRunRow, f: SpireFightRow | null | undefined, m: SpireMemberRow, outcome: number): void {
  emitBossNotice(ctx, {
    tick: T, boss: BossId.Spire, kind: BossNoticeKind.RunResult, player: m.identity, runId: run.id,
    quantity: outcome, total: run.clearTicks, amount: f ? spireSlot(f, 'stars', m.slot) : 0,
  });
}

/**
 * Ends an Active run that did not clear (Wiped, TimedOut, Abandoned, Closed, Reset): present In members are
 * ejected (Done), away In members become Left (their rows ejected directly), Out members stay Out.
 * `refund` gives one spire_key back to each In member of a normal run. Every member that was still part of
 * the run (not Left before the end) gets its RunResult.
 */
function failRun(ctx: Ctx, T: number, io: PlayerIo, run: SpireRunRow, f: SpireFightRow | null | undefined, outcome: number, refund: boolean): SpireRunRow {
  const members = membersOf(ctx, run.id);
  const ended: SpireRunRow = { ...run, stage: SpireStage.Failed, outcome, endTick: T + SPIRE_END_LINGER };
  ctx.db.spireRun.id.update(ended);
  for (const m of members) {
    if (m.state === SpireMemberState.Left) continue;
    if (m.state === SpireMemberState.In) {
      if (refund && run.mode === SpireMode.Normal) giveItem(ctx, m.identity, SPIRE_KEY_ITEM_ID, 1, SPIRE_EXIT, T);
      const p = io.get(m.identity);
      const here = present(p);
      ejectMember(io, m.identity, T, (q) => Math.max(q.hp, SPIRE_KO_HP));
      writeMember(ctx, { ...m, state: here ? SpireMemberState.Done : SpireMemberState.Left });
      if (!here) continue;
    }
    resultNotice(ctx, T, ended, f, m, outcome);
  }
  return ended;
}

/**
 * The clear (section 3.3, 3.12): present In members are ejected first (Done), away members become Left;
 * then every qualifier (>= 3 stars, Done or Out, online, normal run) is paid at the exit.
 */
function clearRun(ctx: Ctx, T: number, io: PlayerIo, run: SpireRunRow, f: SpireFightRow): SpireRunRow {
  const cleared: SpireRunRow = {
    ...run, stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, endTick: T + SPIRE_END_LINGER,
    clearTicks: Math.max(0, T - run.startTick),
  };
  ctx.db.spireRun.id.update(cleared);
  const members = membersOf(ctx, run.id).map((m) => {
    if (m.state !== SpireMemberState.In) return m;
    const here = present(io.get(m.identity));
    ejectMember(io, m.identity, T, (q) => Math.max(q.hp, SPIRE_KO_HP));
    const next = { ...m, state: here ? SpireMemberState.Done : SpireMemberState.Left };
    writeMember(ctx, next);
    return next;
  });
  const names: string[] = [];
  for (const m of members) {
    const p = io.get(m.identity);
    if (p) names.push(p.name);
    if (m.state === SpireMemberState.Left) continue;
    const stars = spireSlot(f, 'stars', m.slot);
    if (p && spireQualifies(stars, m.state, p.online, run.mode)) {
      for (const item of SPIRE_REWARD.items) {
        giveItem(ctx, m.identity, item.itemId, item.quantity, SPIRE_EXIT, T);
        emitBossNotice(ctx, { tick: T, boss: BossId.Spire, kind: BossNoticeKind.Reward, player: m.identity, runId: run.id, itemId: item.itemId, quantity: item.quantity });
      }
      progress(ctx, m.identity, 3, SPIRE_REWARD.fightingXp, Feat.Protect);
      const keepsakes = [SPIRE_REWARD.crown, ...(spireFlawless(f, m.slot, m) ? [SPIRE_REWARD.pendant] : [])];
      for (const cosmetic of keepsakes) {
        if (unlockCosmetic(ctx, m.identity, cosmetic)) {
          emitBossNotice(ctx, { tick: T, boss: BossId.Spire, kind: BossNoticeKind.Keepsake, player: m.identity, runId: run.id, quantity: cosmetic });
        }
      }
    }
    resultNotice(ctx, T, cleared, f, m, SpireOutcome.Cleared);
  }
  emitBossEvent(ctx, {
    tick: T, boss: BossId.Spire, kind: BossEventKind.SpireClear, runId: run.id, quantity: run.partySize,
    value: cleared.clearTicks, text: names.join(', '), x: SPIRE_EXIT.x, z: SPIRE_EXIT.z,
  });
  return cleared;
}

/** Knockout (CORE_SCOPE): state Out, ejected with 10 HP and grace, bag untouched, no death. */
function knockOut(ctx: Ctx, T: number, io: PlayerIo, run: SpireRunRow, m: SpireMemberRow, p: PlayerRow): SpireMemberRow {
  if (onSpireFloor(p)) spireEject(p, SPIRE_KO_HP, T);
  io.save(p);
  const next = { ...m, state: SpireMemberState.Out };
  writeMember(ctx, next);
  emitBossNotice(ctx, { tick: T, boss: BossId.Spire, kind: BossNoticeKind.KnockedOut, player: m.identity, runId: run.id, hp: p.hp, x: p.x, z: p.z });
  return next;
}

// ---- The tick -------------------------------------------------------------------------------------------------------

/** Lobby upkeep: offline (or non-Bramblewild) members drop out, leadership passes on, the TTL deletes the lobby. */
function lobbyUpkeep(t: BossTick, run: SpireRunRow): void {
  const { ctx, T } = t;
  if (T >= run.endTick) { dissolveLobby(ctx, run, SPIRE_BROKE_UP_MESSAGE); return; }
  const members = membersOf(ctx, run.id);
  const kept = members.filter((m) => {
    const p = t.players.get(hex(m.identity));
    if (p && p.online) return true;
    ctx.db.spireMember.identity.delete(m.identity);
    return false;
  });
  if (kept.length === members.length) return;
  if (kept.length === 0) { ctx.db.spireRun.id.delete(run.id); return; }
  const leads = kept.some((m) => hex(m.identity) === hex(run.leader));
  ctx.db.spireRun.id.update({ ...run, partySize: kept.length, leader: leads ? run.leader : kept[0].identity });
}

/** One Active run's tick (section 3.10 order, without the downed state). */
function stepRun(t: BossTick, io: PlayerIo, run0: SpireRunRow, inside: Set<string>): void {
  const { ctx, T } = t;
  const stored = ctx.db.spireFight.runId.find(run0.id);
  // Only a bug leaves an Active run without its fight row: end it (no refund: nothing shows the keys were spent).
  if (!stored) { failRun(ctx, T, io, run0, undefined, SpireOutcome.Reset, false); return; }
  let f: SpireFightRow = { ...stored };
  let run: SpireRunRow = { ...run0 };
  let members = membersOf(ctx, run.id);
  const setMember = (m: SpireMemberRow) => { members = members.map((x) => (x.slot === m.slot && hex(x.identity) === hex(m.identity) ? m : x)); };

  // 0. Presence: away bookkeeping (one member write per change); off the floor while loaded = Left.
  const here = new Map<string, PlayerRow>();
  for (const m0 of members) {
    if (m0.state !== SpireMemberState.In) continue;
    const h = hex(m0.identity);
    const p = t.players.get(h);
    let m = m0;
    if (!p || !p.online) {
      if (m.awaySinceTick === 0) { m = { ...spireMemberBump(m, 'awayCount'), awaySinceTick: Math.max(1, T) }; writeMember(ctx, m); setMember(m); }
      continue;
    }
    if (p.state !== PlayerState.Alive || !onSpireFloor(p)) {
      m = { ...m, state: SpireMemberState.Left, awaySinceTick: 0 };
      writeMember(ctx, m); setMember(m);
      continue;
    }
    if (m.awaySinceTick !== 0) { m = { ...m, awaySinceTick: 0 }; writeMember(ctx, m); setMember(m); }
    here.set(h, p);
  }
  const live = members.filter((m) => m.state === SpireMemberState.In);
  const away = live.filter((m) => !here.has(hex(m.identity)));
  // Abandoned: every In member away, the most recent for 50+ ticks. Keys come back; nobody earns anything.
  if (live.length > 0 && away.length === live.length) {
    const latest = Math.max(...away.map((m) => m.awaySinceTick));
    if (T - latest >= SPIRE_AWAY_TICKS) {
      failRun(ctx, T, io, run, f, SpireOutcome.Abandoned, true);
      writeFight(ctx, stored, f);
      return;
    }
  }
  // Away 50+ ticks while a teammate is present: Left (ejected by a direct write, no reward).
  if (here.size > 0) {
    for (const m of away) {
      if (T - m.awaySinceTick < SPIRE_AWAY_TICKS) continue;
      ejectMember(io, m.identity, T, (q) => Math.max(q.hp, SPIRE_KO_HP));
      const next = { ...m, state: SpireMemberState.Left };
      writeMember(ctx, next); setMember(next);
    }
  }
  const fighters = () => members.filter((m) => m.state === SpireMemberState.In && here.has(hex(m.identity)));
  const ends = (m: SpireMemberRow) => {
    const p = here.get(hex(m.identity))!;
    const before = t.before.get(hex(m.identity));
    const p0: Tile = before && onSpireFloor(before) ? { x: before.x, z: before.z } : { x: p.x, z: p.z };
    const p2: Tile = { x: p.x, z: p.z };
    return { p, p0, p1: spireMiddle(p0, p2, t.blocked), p2 };
  };

  if (T >= run.startTick) {
    // 2. Court swings: the slot's tick, within 4 of the heart, hands free.
    for (const m of fighters()) {
      if (!spireSwingDue(run.startTick, T, m.slot)) continue;
      const p = here.get(hex(m.identity))!;
      if (!inSpireCourt(p) || p.nextSwingTick > T) continue;
      if (p.weapon !== '' && !inHotbar(readSlots(ctx, p.identity).slots, p.weapon)) { p.weapon = ''; t.mark(p); }
      const d = swingDamage(p.weapon);
      f = withSpireSlot({ ...f, hp: Math.max(0, f.hp - d) }, 'dmg', m.slot, spireSlot(f, 'dmg', m.slot) + d);
      if (f.hp <= 0) { clearRun(ctx, T, io, run, f); writeFight(ctx, stored, f); return; }
    }
    // 3. Stars: the wave's mask resets once per wave; P1 or P2 on a star catches it.
    const wave = spireStarWave(run.startTick, T);
    if (f.starWave !== wave) f = { ...f, starWave: wave, starMask: 0 };
    const stars = spireStars(f.seed, wave, run.partySize + 2);
    for (const m of fighters()) {
      const { p1, p2 } = ends(m);
      for (let j = 0; j < stars.length; j++) {
        if (f.starMask & (1 << j)) continue;
        const s = stars[j];
        if (!(s.x === p1.x && s.z === p1.z) && !(s.x === p2.x && s.z === p2.z)) continue;
        const caught = spireSlot(f, 'stars', m.slot) + 1;
        f = { ...f, starMask: f.starMask | (1 << j), hp: Math.max(0, f.hp - SPIRE_STAR_DAMAGE) };
        f = withSpireSlot(withSpireSlot(f, 'stars', m.slot, caught), 'dmg', m.slot, spireSlot(f, 'dmg', m.slot) + SPIRE_STAR_DAMAGE);
        emitBossNotice(ctx, { tick: T, boss: BossId.Spire, kind: BossNoticeKind.Star, player: m.identity, runId: run.id, amount: SPIRE_STAR_DAMAGE, total: spireSlot(f, 'stars', m.slot), x: s.x, z: s.z });
        if (f.hp <= 0) { clearRun(ctx, T, io, run, f); writeFight(ctx, stored, f); return; }
      }
    }
    // 4. Bullets: one hit per member per tick, 2 ticks of i-frames after a hit.
    const bullets = spireFightBullets(f);
    const damage = spireBulletDamage(f.phase, spireEnraged(run.startTick, T));
    for (const m of members) {
      if (m.state !== SpireMemberState.In) continue;
      if (spireImmune(spireSlot(f, 'hitTick', m.slot), T)) continue;
      const h = hex(m.identity);
      if (here.has(h)) {
        const { p, p0, p1, p2 } = ends(m);
        const k = bullets.length ? spireHitsMove(bullets, T, p0, p1, p2) : 0;
        if (k) {
          p.hp = Math.max(0, p.hp - damage);
          t.mark(p);
          f = hitSlot(f, m.slot, T);
          emitBossNotice(ctx, { tick: T, boss: BossId.Spire, kind: BossNoticeKind.Hurt, player: m.identity, runId: run.id, amount: damage, hp: p.hp, half: k, quantity: HurtSource.Bullet, x: p.x, z: p.z });
        }
        if (p.hp <= 0) { setMember(knockOut(ctx, T, io, run, m, p)); here.delete(h); }
        continue;
      }
      // An away member's frozen tile still takes hits; only its first away episode floors HP at 1.
      const p = io.get(m.identity);
      if (!p) continue;
      const at: Tile = { x: p.x, z: p.z };
      const k = bullets.length ? spireHitsMove(bullets, T, at, at, at) : 0;
      if (!k) continue;
      p.hp = m.awayCount === 1 ? Math.max(1, p.hp - damage) : Math.max(0, p.hp - damage);
      f = hitSlot(f, m.slot, T);
      emitBossNotice(ctx, { tick: T, boss: BossId.Spire, kind: BossNoticeKind.Hurt, player: m.identity, runId: run.id, amount: damage, hp: p.hp, half: k, quantity: HurtSource.Bullet, x: p.x, z: p.z });
      if (p.hp <= 0) setMember(knockOut(ctx, T, io, run, m, p));
      else io.save(p);
    }
  }

  // 5. Wipe: nobody In any more (away In members still count).
  if (!members.some((m) => m.state === SpireMemberState.In)) {
    failRun(ctx, T, io, run, f, SpireOutcome.Wiped, false);
    writeFight(ctx, stored, f);
    return;
  }
  // 6. Time limit.
  if (T >= run.endTick) {
    failRun(ctx, T, io, run, f, SpireOutcome.TimedOut, false);
    writeFight(ctx, stored, f);
    return;
  }
  // 7. Pattern rotation at the end of the tick: fans aim at present In members (slot order, end tiles).
  if (spirePatternDue(f, T)) {
    const targets = fighters().map((m) => { const p = here.get(hex(m.identity))!; return { x: p.x, z: p.z }; });
    f = spireNextPattern(f, run.startTick, T, targets);
    if (f.phase !== run.phase) run = { ...run, phase: f.phase };
  }
  for (const m of fighters()) inside.add(hex(m.identity));
  // 8. One fight write, run writes only on transitions.
  writeFight(ctx, stored, f);
  if (!sameRowShallow(run0, run)) ctx.db.spireRun.id.update(run);
}

function hitSlot(f: SpireFightRow, slot: number, T: number): SpireFightRow {
  return withSpireSlot(withSpireSlot(f, 'hitTick', slot, T), 'hits', slot, spireSlot(f, 'hits', slot) + 1);
}

function writeFight(ctx: Ctx, stored: SpireFightRow, f: SpireFightRow): void {
  if (!sameRowShallow(stored, f)) ctx.db.spireFight.runId.update(f);
}

/** Lobby upkeep, Active runs (presence, swings, stars, bullets, knockouts, rotation), cleanup, the stranded sweep. */
export function phaseSpire(t: BossTick): void {
  const { ctx, T } = t;
  if (!ctx.db.spireRun || !ctx.db.spireMember || !ctx.db.spireFight) return;
  const inside = new Set<string>();
  if (ctx.db.spireRun.count() > 0n) {
    const cfg = readBossConfig(ctx);
    const io = tickIo(t);
    const runs = [...ctx.db.spireRun.iter()].sort((a, b) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const run of runs) {
      const live = run.stage === SpireStage.Lobby || run.stage === SpireStage.Queued || run.stage === SpireStage.Active;
      if (live && run.rules !== SPIRE_RULES_VERSION) { spireReset(ctx, T, io, run); continue; }
      if (run.stage === SpireStage.Lobby || run.stage === SpireStage.Queued) {
        if (!modeOpen(cfg, run.mode)) dissolveLobby(ctx, run, SPIRE_CLOSED_MESSAGE);
        else lobbyUpkeep(t, run);
      } else if (run.stage === SpireStage.Active) {
        // configure_bosses already failed (and refunded) every run when the switch went off; this only catches
        // rows the owner close never saw, so it skips the fight and ends the run without a refund.
        if (!modeOpen(cfg, run.mode)) failRun(ctx, T, io, run, ctx.db.spireFight.runId.find(run.id), SpireOutcome.Closed, false);
        else stepRun(t, io, run, inside);
      } else if (T >= run.endTick) {
        deleteRun(ctx, run.id);
      }
    }
  }
  // Stranded sweep: nobody stands on the floor without a present In membership of an Active run.
  for (const h of t.order) {
    const p = t.players.get(h);
    if (!p || inside.has(h) || !p.online || p.state !== PlayerState.Alive || !onSpireFloor(p)) continue;
    spireEject(p, Math.max(p.hp, SPIRE_KO_HP), T);
    t.mark(p);
  }
}

function modeOpen(cfg: { spireOpen: boolean }, mode: number): boolean {
  // Practice runs are cut (CORE_SCOPE): only normal runs exist; anything else counts as sealed.
  return mode === SpireMode.Normal && cfg.spireOpen;
}

/** A run from an older SPIRE_RULES_VERSION: lobbies are deleted, Active runs fail with Reset and refunds. */
function spireReset(ctx: Ctx, T: number, io: PlayerIo, run: SpireRunRow): void {
  if (run.stage === SpireStage.Active) failRun(ctx, T, io, run, ctx.db.spireFight.runId.find(run.id), SpireOutcome.Reset, true);
  else dissolveLobby(ctx, run, SPIRE_UPDATED_MESSAGE);
}

// ---- Owner effects and helpers shared with the reducers -------------------------------------------------------------

/** Owner close of a mode: lobbies deleted (members notified), Active runs fail with Closed and refund keys. */
export function spireCloseMode(ctx: Ctx, T: number, mode: SpireMode): void {
  if (!ctx.db.spireRun || ctx.db.spireRun.count() === 0n) return;
  const io = directIo(ctx);
  for (const run of [...ctx.db.spireRun.iter()]) {
    if (run.mode !== mode) continue;
    if (run.stage === SpireStage.Lobby || run.stage === SpireStage.Queued) dissolveLobby(ctx, run, SPIRE_CLOSED_MESSAGE);
    else if (run.stage === SpireStage.Active) failRun(ctx, T, io, run, ctx.db.spireFight.runId.find(run.id), SpireOutcome.Closed, true);
  }
}

/** Player rows for the start effects: the reducer passes `findPlayer` copies and `savePlayer`. */
export interface SpireStartIo {
  /** A mutable player row, or undefined. */
  player(hex: string): PlayerRow | undefined;
  /** Persist a row returned by `player` or `others`. */
  save(p: PlayerRow): void;
  /** Every other player whose `combatTarget` may point at a member. */
  others(): Iterable<PlayerRow>;
}

/**
 * Start effects (section 3.3): per member consume one spire_key, clear interactions (this also stops a queued
 * walk to the Meadows), cancel trades, clear combat targets that point at them, end grace, teleport to
 * SPIRE_SPAWNS[slot], state In; run Active with startTick = T + 5; insert spire_fight with the first pattern
 * published; boss_event SpireRunStart.
 */
export function spireStartRun(ctx: Ctx, T: number, run: SpireRunRow, members: readonly SpireMemberRow[], io: SpireStartIo): void {
  const sorted = [...members].sort((a, b) => a.slot - b.slot);
  const ids = new Set(sorted.map((m) => hex(m.identity)));
  const startTick = T + SPIRE_INTRO_TICKS;
  const spawns: Tile[] = [];
  for (const m of sorted) {
    const p = io.player(hex(m.identity));
    if (!p) continue;
    if (run.mode === SpireMode.Normal) spend(ctx, p.identity, SPIRE_KEY_ITEM_ID, 1);
    clearInteractions(ctx, p);
    for (const trade of tradesOf(ctx, p.identity)) cancelTrade(ctx, trade, 'Trade cancelled: they went down into the Sunken Spire');
    p.respawnTick = Math.min(p.respawnTick, Math.max(0, T - RESPAWN_GRACE_TICKS));
    const spawn = SPIRE_SPAWNS[m.slot] ?? SPIRE_SPAWNS[0];
    p.x = spawn.x; p.z = spawn.z;
    io.save(p);
    spawns.push({ x: spawn.x, z: spawn.z });
    writeMember(ctx, { ...m, state: SpireMemberState.In, awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0 });
  }
  for (const q of io.others()) {
    if (ids.has(hex(q.identity)) || !q.combatTarget || !ids.has(hex(q.combatTarget))) continue;
    const next = { ...q, combatTarget: undefined, hostile: false };
    if (q.pending === Pending.Trade) { next.pending = Pending.None; next.pendingId = 0n; next.targetX = undefined; next.targetZ = undefined; }
    io.save(next);
  }
  const n = sorted.length;
  const maxHp = spireMaxHp(readBossConfig(ctx), n);
  ctx.db.spireRun.id.update({
    ...run, stage: SpireStage.Active, outcome: SpireOutcome.None, partySize: n, startTick,
    endTick: startTick + SPIRE_TIME_LIMIT, phase: 1, clearTicks: 0,
  });
  const fresh: SpireFightRow = {
    runId: run.id, hp: maxHp, maxHp, phase: 1, seed: spireSeed(run.id, startTick), patternCount: 0,
    curKind: SPIRE_NONE, curStart: 0, curSeed: 0, curAimX: 0, curAimZ: 0,
    prevKind: SPIRE_NONE, prevStart: 0, prevSeed: 0, prevAimX: 0, prevAimZ: 0,
    starWave: 0, starMask: 0,
    hitTick0: 0, hitTick1: 0, hitTick2: 0, hitTick3: 0, hits0: 0, hits1: 0, hits2: 0, hits3: 0,
    stars0: 0, stars1: 0, stars2: 0, stars3: 0, dmg0: 0, dmg1: 0, dmg2: 0, dmg3: 0,
    downs0: 0, downs1: 0, downs2: 0, downs3: 0,
  };
  const old = ctx.db.spireFight.runId.find(run.id);
  if (old) ctx.db.spireFight.runId.delete(run.id);
  ctx.db.spireFight.insert(spireNextPattern(fresh, startTick, startTick, spawns));
  emitBossEvent(ctx, { tick: T, boss: BossId.Spire, kind: BossEventKind.SpireRunStart, runId: run.id, quantity: n, x: SPIRE_EXIT.x, z: SPIRE_EXIT.z });
}

/** Owner debug ops for live checks: spire_hp, spire_phase, spire_fail_all. */
export function spireDebug(ctx: Ctx, T: number, op: string, runId: bigint, value: number): void {
  if (op === 'spire_fail_all') {
    const io = directIo(ctx);
    for (const run of [...ctx.db.spireRun.iter()]) {
      if (run.stage === SpireStage.Active) failRun(ctx, T, io, run, ctx.db.spireFight.runId.find(run.id), SpireOutcome.Closed, true);
    }
    return;
  }
  if (op !== 'spire_hp' && op !== 'spire_phase') throw new SenderError('This debug action does not exist');
  const run = ctx.db.spireRun.id.find(runId);
  const f = ctx.db.spireFight.runId.find(runId);
  if (!run || run.stage !== SpireStage.Active || !f) throw new SenderError('This run is not active');
  if (op === 'spire_hp') {
    ctx.db.spireFight.runId.update({ ...f, hp: Math.min(f.maxHp, Math.max(1, Math.floor((f.maxHp * value) / 100))) });
  } else {
    // Effective at the next pattern boundary (the scheduler never lowers a phase it computes itself).
    ctx.db.spireFight.runId.update({ ...f, phase: Math.max(1, Math.min(4, Math.floor(value))) });
  }
}

/**
 * The member-row lifecycle shared by spire_open and spire_join (section 3.3): deletes a stale or Left row and
 * returns null, or returns the refusal ("You are already in a Spire party" / "You still belong to a party that
 * is fighting ({s} s left); leave it to give up its reward").
 */
export function spireMembershipProblem(ctx: Ctx, me: PlayerRow, T: number): string | null {
  const m = ctx.db.spireMember.identity.find(me.identity);
  if (!m) return null;
  const run = ctx.db.spireRun.id.find(m.runId);
  if (!run || run.stage === SpireStage.Cleared || run.stage === SpireStage.Failed
    || (run.stage === SpireStage.Active && m.state === SpireMemberState.Left)) {
    ctx.db.spireMember.identity.delete(me.identity);
    return null;
  }
  if (run.stage === SpireStage.Active && m.state === SpireMemberState.Out) {
    const s = Math.max(0, Math.ceil((run.endTick - T) * 0.6));
    return `You still belong to a party that is fighting (${s} s left); leave it to give up its reward`;
  }
  return 'You are already in a Spire party';
}

/** A member's live membership for spire_leave: run Lobby/Queued, or Active with state In, Downed or Out. */
export function spireLiveMembership(ctx: Ctx, id: Identity): { m: SpireMemberRow; run: SpireRunRow } | null {
  const m = ctx.db.spireMember.identity.find(id);
  if (!m) return null;
  const run = ctx.db.spireRun.id.find(m.runId);
  if (!run) return null;
  if (run.stage === SpireStage.Lobby || run.stage === SpireStage.Queued) return { m, run };
  if (run.stage === SpireStage.Active
    && (m.state === SpireMemberState.In || m.state === SpireMemberState.Downed || m.state === SpireMemberState.Out)) return { m, run };
  return null;
}

/** Removes a lobby member: leadership passes to the lowest remaining slot; an empty run is deleted. */
export function spireLeaveLobby(ctx: Ctx, run: SpireRunRow, id: Identity): void {
  ctx.db.spireMember.identity.delete(id);
  const rest = membersOf(ctx, run.id);
  if (rest.length === 0) { ctx.db.spireRun.id.delete(run.id); return; }
  const leads = hex(run.leader) !== hex(id);
  ctx.db.spireRun.id.update({ ...run, partySize: rest.length, leader: leads ? run.leader : rest[0].identity });
}

/** spire_leave during a run: In → Left (ejected with hp >= 1, no reward, no result); Out → the row goes. */
export function spireForfeit(ctx: Ctx, T: number, m: SpireMemberRow, p: PlayerRow): void {
  if (m.state === SpireMemberState.Out) { ctx.db.spireMember.identity.delete(m.identity); return; }
  writeMember(ctx, { ...m, state: SpireMemberState.Left, awaySinceTick: 0 });
  if (onSpireFloor(p)) spireEject(p, Math.max(p.hp, m.state === SpireMemberState.Downed ? SPIRE_KO_HP : 1), T);
}

/** Members of a run in slot order (for the reducers). */
export function spireMembers(ctx: Ctx, runId: bigint): SpireMemberRow[] {
  return membersOf(ctx, runId);
}
