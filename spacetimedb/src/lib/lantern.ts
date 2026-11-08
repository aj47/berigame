import { SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import {
  BossEventKind, BossId, BossNoticeKind, Feat, HurtSource, LANTERN_AWAY_TICKS, LANTERN_BAIT, LANTERN_BITE_DAMAGE, LANTERN_CONFIG_ID,
  LANTERN_DROWN_DAMAGE, LANTERN_END_LINGER, LANTERN_ENTRY_FEE, LANTERN_EXIT, LANTERN_GATE, LANTERN_INTRO_TICKS, LANTERN_KO_HP,
  LANTERN_REWARD, LANTERN_RULES_VERSION, LANTERN_SPAWNS, LANTERN_TIME_LIMIT, Pending, PlayerState, RESPAWN_GRACE_TICKS, SocialNotice,
  SpireMemberState, SpireOutcome, SpireStage, inHotbar, lanternAdvance, lanternBlowAt, lanternClearReward, lanternConfigOr,
  lanternEmptySlots, lanternEntryRejection, lanternFreshFight, lanternLocal, lanternMaxHp, lanternPulseAt, lanternResolveTick,
  lanternSeed, lanternSlot, lanternTile, lanternUtcDay, swingDamage, withLanternSlot,
  type LanternConfigLike, type LanternFightLike, type LanternMemberSim, type LanternRunSim, type Tile,
} from '../../../shared/sim';
import { newProfile } from '../../../shared/sim/frontier/model';
import { progress, spend } from './adventure';
import type { BossTick } from './bossTick';
import { frontierRepository, projectFrontier } from './frontier';
import { giveItem, readSlots } from './inventory';
import { clearInteractions, hex } from './players';
import { emitBossEvent, emitBossNotice, sameRowShallow } from './rows';
import { cancelTrade, notify, tradesOf } from './social';
import { onLanternFloor } from './spireGuards';
import type { Ctx, LanternFightRow, LanternMemberRow, LanternRunRow, PlayerRow } from './types';
import { loadPlayer, storePlayer } from './playerStore';

/**
 * Lanternmaw's Drowned Hollow on the server (docs/design/BOSSES.md section 9).
 *
 * The Spire's machinery on its own tables: one sealed floor shared by every
 * run (logical instancing), lobbies at the Fen Gate, knockouts that never kill
 * (ejected with 10 HP and 10 ticks of grace, bag untouched), 50-tick away
 * grace, 6 meals, refunds of the bait and the fee on an owner close, a rules
 * reset or a whole-party abandon, and the rules version.
 *
 * The fight itself is the shared reference: every Active tick builds a
 * `LanternRunSim` from the rows and calls `lanternResolveTick`, then writes
 * the differences back (HP, knockouts, notices, one fight row). Browsers and
 * agents run the same function, so they never disagree about a tile.
 */

const LANTERN_CLOSED_MESSAGE = 'The Drowned Hollow was sealed; your party broke up';
const LANTERN_UPDATED_MESSAGE = 'The Drowned Hollow was updated: open a new party';
const LANTERN_BROKE_UP_MESSAGE = 'The Lanternmaw party broke up';

/** The switch and HP knobs: the `lantern_config` row, or the defaults (closed). One PK read. */
export function readLanternConfig(ctx: Ctx): LanternConfigLike {
  return lanternConfigOr(ctx.db.lanternConfig?.id.find(LANTERN_CONFIG_ID));
}

interface PlayerIo {
  get(id: Identity): PlayerRow | undefined;
  save(p: PlayerRow): void;
}

function directIo(ctx: Ctx): PlayerIo {
  return {
    get: (id) => { const row = loadPlayer(ctx, id); return row ? { ...row } : undefined; },
    save: (p) => storePlayer(ctx, p),
  };
}

function tickIo(t: BossTick): PlayerIo {
  return {
    get: (id) => {
      const loaded = t.players.get(hex(id));
      if (loaded) return loaded;
      const row = loadPlayer(t.ctx, id);
      return row ? { ...row } : undefined;
    },
    save: (p) => {
      if (t.players.get(hex(p.identity)) === p) t.mark(p);
      else storePlayer(t.ctx, p);
    },
  };
}

function present(p: PlayerRow | undefined): p is PlayerRow {
  return !!p && p.online && p.state === PlayerState.Alive && onLanternFloor(p);
}

/** To LANTERN_EXIT with targets and interactions cleared and 10 ticks of grace. The bag is never touched. */
function lanternEject(p: PlayerRow, hp: number, T: number): void {
  p.x = LANTERN_EXIT.x; p.z = LANTERN_EXIT.z;
  p.targetX = undefined; p.targetZ = undefined;
  p.pending = Pending.None; p.pendingId = 0n;
  p.combatTarget = undefined; p.hostile = false;
  p.respawnTick = T;
  p.hp = Math.max(1, Math.min(255, Math.floor(hp)));
}

function ejectMember(io: PlayerIo, id: Identity, T: number, hp: (p: PlayerRow) => number): PlayerRow | undefined {
  const p = io.get(id);
  if (!p) return undefined;
  if (onLanternFloor(p)) { lanternEject(p, hp(p), T); io.save(p); }
  return p;
}

function membersOf(ctx: Ctx, runId: bigint): LanternMemberRow[] {
  return [...ctx.db.lanternMember.runId.filter(runId)].sort((a, b) => a.slot - b.slot);
}

function writeMember(ctx: Ctx, m: LanternMemberRow): void {
  ctx.db.lanternMember.identity.update(m);
}

function dissolveLobby(ctx: Ctx, run: LanternRunRow, text: string): void {
  const members = membersOf(ctx, run.id);
  for (const m of members) ctx.db.lanternMember.identity.delete(m.identity);
  ctx.db.lanternRun.id.delete(run.id);
  for (const m of members) notify(ctx, m.identity, m.identity, SocialNotice.Info, text);
}

function deleteRun(ctx: Ctx, runId: bigint): void {
  for (const m of membersOf(ctx, runId)) ctx.db.lanternMember.identity.delete(m.identity);
  if (ctx.db.lanternFight.runId.find(runId)) ctx.db.lanternFight.runId.delete(runId);
  ctx.db.lanternRun.id.delete(runId);
}

// ---- Coins (the entry fee, debited through the frontier ledger like a trade) --------------------------------------

/** A member's coin balance. */
export function lanternCoins(ctx: Ctx, id: Identity): number {
  return frontierRepository(ctx).get('profile', hex(id))?.coins ?? 0;
}

/** Moves `delta` coins per identity with one ledger line each ('fee:lanternmaw' or 'refund:lanternmaw'). */
function moveCoins(ctx: Ctx, ids: readonly Identity[], delta: number, runId: bigint, reason: string): void {
  if (!ids.length) return;
  const repo = frontierRepository(ctx);
  const at = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
  for (const id of ids) {
    const p = repo.get('profile', hex(id)) ?? newProfile(hex(id));
    p.coins = Math.max(0, p.coins + delta);
    repo.put('profile', p);
    repo.put('ledger', { id: `lantern-${reason}-${runId}-${hex(id)}`, owner: p.id, amount: delta, reason, at });
  }
  projectFrontier(ctx, repo);
}

/** One Fen Bait and the fee back (an owner close, a rules reset, an abandon). */
function refundMembers(ctx: Ctx, T: number, run: LanternRunRow, ids: readonly Identity[]): void {
  for (const id of ids) giveItem(ctx, id, LANTERN_BAIT.itemId, 1, LANTERN_EXIT, T);
  moveCoins(ctx, ids, LANTERN_ENTRY_FEE, run.id, 'refund:lanternmaw');
}

// ---- Endings ---------------------------------------------------------------------------------------------------------

function resultNotice(ctx: Ctx, T: number, run: LanternRunRow, f: LanternFightRow | null | undefined, m: LanternMemberRow, outcome: number): void {
  emitBossNotice(ctx, {
    tick: T, boss: BossId.Lanternmaw, kind: BossNoticeKind.RunResult, player: m.identity, runId: run.id,
    quantity: outcome, total: run.clearTicks, amount: f ? lanternSlot(f, 'dmg', m.slot) : 0,
  });
}

/** Ends an Active run that did not clear (as the Spire's failRun); `refund` returns bait and fee to every In member. */
function failRun(ctx: Ctx, T: number, io: PlayerIo, run: LanternRunRow, f: LanternFightRow | null | undefined, outcome: number, refund: boolean): LanternRunRow {
  const members = membersOf(ctx, run.id);
  const ended: LanternRunRow = { ...run, stage: SpireStage.Failed, outcome, endTick: T + LANTERN_END_LINGER };
  ctx.db.lanternRun.id.update(ended);
  const refunds: Identity[] = [];
  for (const m of members) {
    if (m.state === SpireMemberState.Left) continue;
    if (m.state === SpireMemberState.In) {
      if (refund) refunds.push(m.identity);
      const here = present(io.get(m.identity));
      ejectMember(io, m.identity, T, (q) => Math.max(q.hp, LANTERN_KO_HP));
      writeMember(ctx, { ...m, state: here ? SpireMemberState.Done : SpireMemberState.Left });
      if (!here) continue;
    }
    resultNotice(ctx, T, ended, f, m, outcome);
  }
  if (refunds.length) refundMembers(ctx, T, run, refunds);
  return ended;
}

/** Fenlight-paying clears this character already had today. */
function paidToday(ctx: Ctx, id: Identity, day: number): number {
  const row = ctx.db.lanternPaid.identity.find(id);
  return row && row.day === day ? row.paid : 0;
}

function recordPaid(ctx: Ctx, id: Identity, day: number, paid: number): void {
  const row = { identity: id, day, paid: Math.min(255, paid) };
  if (ctx.db.lanternPaid.identity.find(id)) ctx.db.lanternPaid.identity.update(row); else ctx.db.lanternPaid.insert(row);
}

/**
 * The clear (9.10): present In members are ejected first (Done), away ones become Left; then every member with
 * 40+ damage, Done or Out and online gets 120 Fighting XP, and 2 fenlight within the daily cap.
 */
function clearRun(ctx: Ctx, T: number, io: PlayerIo, run: LanternRunRow, f: LanternFightRow): void {
  const cleared: LanternRunRow = {
    ...run, stage: SpireStage.Cleared, outcome: SpireOutcome.Cleared, endTick: T + LANTERN_END_LINGER, clearTicks: Math.max(0, T - run.startTick),
  };
  ctx.db.lanternRun.id.update(cleared);
  const members = membersOf(ctx, run.id).map((m) => {
    if (m.state !== SpireMemberState.In) return m;
    const here = present(io.get(m.identity));
    ejectMember(io, m.identity, T, (q) => Math.max(q.hp, LANTERN_KO_HP));
    const next = { ...m, state: here ? SpireMemberState.Done : SpireMemberState.Left };
    writeMember(ctx, next);
    return next;
  });
  const day = lanternUtcDay(Number(ctx.timestamp.microsSinceUnixEpoch / 1000n));
  const names: string[] = [];
  for (const m of members) {
    const p = io.get(m.identity);
    if (p) names.push(p.name);
    if (m.state === SpireMemberState.Left) continue;
    const done = m.state === SpireMemberState.Done || m.state === SpireMemberState.Out;
    const before = paidToday(ctx, m.identity, day);
    const reward = lanternClearReward(lanternSlot(f, 'dmg', m.slot), done && !!p?.online, before);
    for (const item of reward.items) {
      giveItem(ctx, m.identity, item.itemId, item.quantity, LANTERN_EXIT, T);
      emitBossNotice(ctx, { tick: T, boss: BossId.Lanternmaw, kind: BossNoticeKind.Reward, player: m.identity, runId: run.id, itemId: item.itemId, quantity: item.quantity });
    }
    if (reward.paid) recordPaid(ctx, m.identity, day, before + 1);
    if (reward.fightingXp) progress(ctx, m.identity, 3, reward.fightingXp, Feat.Protect);
    resultNotice(ctx, T, cleared, f, m, SpireOutcome.Cleared);
  }
  emitBossEvent(ctx, {
    tick: T, boss: BossId.Lanternmaw, kind: BossEventKind.LanternClear, runId: run.id, quantity: run.partySize,
    value: cleared.clearTicks, text: names.join(', '), x: LANTERN_GATE.x, z: LANTERN_GATE.z,
  });
}

function knockOut(ctx: Ctx, T: number, io: PlayerIo, run: LanternRunRow, m: LanternMemberRow, p: PlayerRow): LanternMemberRow {
  if (onLanternFloor(p)) lanternEject(p, LANTERN_KO_HP, T);
  io.save(p);
  const next = { ...m, state: SpireMemberState.Out };
  writeMember(ctx, next);
  emitBossNotice(ctx, { tick: T, boss: BossId.Lanternmaw, kind: BossNoticeKind.KnockedOut, player: m.identity, runId: run.id, hp: p.hp, x: p.x, z: p.z });
  return next;
}

// ---- The tick -------------------------------------------------------------------------------------------------------

function lobbyUpkeep(t: BossTick, run: LanternRunRow): void {
  const { ctx, T } = t;
  if (T >= run.endTick) { dissolveLobby(ctx, run, LANTERN_BROKE_UP_MESSAGE); return; }
  const members = membersOf(ctx, run.id);
  const kept = members.filter((m) => {
    const p = t.players.get(hex(m.identity));
    if (p && p.online) return true;
    ctx.db.lanternMember.identity.delete(m.identity);
    return false;
  });
  if (kept.length === members.length) return;
  if (kept.length === 0) { ctx.db.lanternRun.id.delete(run.id); return; }
  const leads = kept.some((m) => hex(m.identity) === hex(run.leader));
  ctx.db.lanternRun.id.update({ ...run, partySize: kept.length, leader: leads ? run.leader : kept[0].identity });
}

/** The LanternFightLike fields of a row (the reference works on these; the slot columns stay on the row). */
const FIGHT_KEYS = ['seed', 'hp', 'maxHp', 'phase', 'partySize', 'stage', 'cycle', 'denCount', 'patternCount', 'curKind', 'curStart',
  'curSeed', 'curAim', 'surfaceTick', 'spring', 'pulseSeed', 'capped'] as const;
function fightOf(f: LanternFightRow): LanternFightLike {
  const out = {} as Record<string, unknown>;
  for (const k of FIGHT_KEYS) out[k] = f[k];
  return out as unknown as LanternFightLike;
}
function withFight(row: LanternFightRow, f: LanternFightLike): LanternFightRow {
  const out: LanternFightRow = { ...row };
  for (const k of FIGHT_KEYS) (out as Record<string, unknown>)[k] = f[k];
  // u8 columns: the reference keeps these small (curAim is a local tile < 225, seeds 6 bits, phase 1..3).
  return out;
}

function writeFight(ctx: Ctx, stored: LanternFightRow, f: LanternFightRow): void {
  if (!sameRowShallow(stored, f)) ctx.db.lanternFight.runId.update(f);
}

/** One Active run's tick: presence, then `lanternResolveTick` on the end tiles, then the write-back. */
function stepRun(t: BossTick, io: PlayerIo, run0: LanternRunRow, inside: Set<string>): void {
  const { ctx, T } = t;
  const stored = ctx.db.lanternFight.runId.find(run0.id);
  if (!stored) { failRun(ctx, T, io, run0, undefined, SpireOutcome.Reset, false); return; }
  let row: LanternFightRow = { ...stored };
  let run: LanternRunRow = { ...run0 };
  let members = membersOf(ctx, run.id);
  const setMember = (m: LanternMemberRow) => { members = members.map((x) => (x.slot === m.slot ? m : x)); };

  // 0. Presence (as the Spire): away bookkeeping; off the floor while loaded = Left.
  const here = new Map<string, PlayerRow>();
  for (const m0 of members) {
    if (m0.state !== SpireMemberState.In) continue;
    const h = hex(m0.identity);
    const p = t.players.get(h);
    let m = m0;
    if (!p || !p.online) {
      if (m.awaySinceTick === 0) { m = { ...m, awayCount: Math.min(255, m.awayCount + 1), awaySinceTick: Math.max(1, T) }; writeMember(ctx, m); setMember(m); }
      continue;
    }
    if (p.state !== PlayerState.Alive || !onLanternFloor(p) || lanternLocal(p) < 0) {
      m = { ...m, state: SpireMemberState.Left, awaySinceTick: 0 };
      writeMember(ctx, m); setMember(m);
      continue;
    }
    if (m.awaySinceTick !== 0) { m = { ...m, awaySinceTick: 0 }; writeMember(ctx, m); setMember(m); }
    here.set(h, p);
  }
  const live = members.filter((m) => m.state === SpireMemberState.In);
  const away = live.filter((m) => !here.has(hex(m.identity)));
  if (live.length > 0 && away.length === live.length) {
    const latest = Math.max(...away.map((m) => m.awaySinceTick));
    if (T - latest >= LANTERN_AWAY_TICKS) { failRun(ctx, T, io, run, row, SpireOutcome.Abandoned, true); return; }
  }
  if (here.size > 0) {
    for (const m of away) {
      if (T - m.awaySinceTick < LANTERN_AWAY_TICKS) continue;
      ejectMember(io, m.identity, T, (q) => Math.max(q.hp, LANTERN_KO_HP));
      const next = { ...m, state: SpireMemberState.Left };
      writeMember(ctx, next); setMember(next);
    }
  }

  if (T >= run.startTick) {
    // 1-6. The shared reference on this tick's end tiles (movement already ran).
    const inMembers = members.filter((m) => m.state === SpireMemberState.In);
    const sims: LanternMemberSim[] = inMembers.map((m) => {
      const p = here.get(hex(m.identity));
      if (p && p.weapon !== '' && !inHotbar(readSlots(ctx, p.identity).slots, p.weapon)) { p.weapon = ''; t.mark(p); }
      return {
        slot: m.slot, tile: p ? lanternLocal(p) : 0, hp: p ? p.hp : 0, maxHp: p ? p.maxHp : 0, weapon: p ? swingDamage(p.weapon) : 0,
        present: !!p, nextSwingTick: p ? p.nextSwingTick : 0, hitTick: lanternSlot(row, 'hitTick', m.slot),
        dealt: lanternSlot(row, 'dmg', m.slot), hits: lanternSlot(row, 'hits', m.slot), drowned: lanternSlot(row, 'drowned', m.slot),
        caps: lanternSlot(row, 'caps', m.slot), meals: m.meals,
      };
    });
    const before = fightOf(row);
    const sim: LanternRunSim = { startTick: run.startTick, endTick: run.endTick, fight: before, members: sims, outcome: '', clearTick: 0 };
    const out = lanternResolveTick(sim, T);
    // Which hazard hurt whom (for the notices): blows do not depend on steps 1-2; pulses skip once it is capped.
    const blow = lanternBlowAt(before, T, run.startTick);
    const pulse = lanternPulseAt({ ...before, capped: before.capped || out.fight.capped }, T, run.startTick);
    for (let j = 0; j < inMembers.length; j++) {
      const m = inMembers[j], a = sims[j], b = out.members[j];
      if (!a.present) continue;
      const p = here.get(hex(m.identity))!;
      const say = (amount: number, source: number) => emitBossNotice(ctx, {
        tick: T, boss: BossId.Lanternmaw, kind: BossNoticeKind.Hurt, player: m.identity, runId: run.id, amount, hp: Math.max(0, b.hp),
        quantity: source, x: p.x, z: p.z,
      });
      if (b.caps > a.caps) say(LANTERN_BITE_DAMAGE, HurtSource.Bite);
      if (b.hits > a.hits) {
        const bd = blow && blow.tiles[a.tile] ? blow.damage : 0, pd = pulse && pulse.tiles[a.tile] ? pulse.damage : 0;
        say(Math.max(bd, pd), bd >= pd ? HurtSource.Blow : HurtSource.Pulse);
      }
      if (b.drowned > a.drowned) say(LANTERN_DROWN_DAMAGE, HurtSource.Drown);
      for (const k of ['hitTick', 'hits', 'drowned', 'caps'] as const) {
        const v = k === 'hitTick' ? b.hitTick : b[k];
        if (lanternSlot(row, k, m.slot) !== v) row = withLanternSlot(row, k, m.slot, v);
      }
      if (b.dealt !== a.dealt) row = withLanternSlot(row, 'dmg', m.slot, b.dealt);
      if (b.hp !== a.hp) { p.hp = Math.max(0, b.hp); t.mark(p); }
      if (!b.present) { setMember(knockOut(ctx, T, io, run, m, p)); here.delete(hex(m.identity)); }
    }
    let f = out.fight;
    if (out.outcome === 'cleared') {
      row = withFight(row, f);
      clearRun(ctx, T, io, run, row);
      writeFight(ctx, stored, row);
      return;
    }
    // The reference has no away members; on the server they still count, so its wipe is only a wipe when none is left.
    const wiped = out.outcome === 'wiped' && !members.some((m) => m.state === SpireMemberState.In);
    if (wiped) { row = withFight(row, f); failRun(ctx, T, io, run, row, SpireOutcome.Wiped, false); writeFight(ctx, stored, row); return; }
    if (out.outcome === 'timeout' || (out.outcome === 'wiped' && T >= run.endTick)) {
      row = withFight(row, f); failRun(ctx, T, io, run, row, SpireOutcome.TimedOut, false); writeFight(ctx, stored, row); return;
    }
    if (out.outcome === 'wiped') f = lanternAdvance(f, T, run.startTick, []);
    row = withFight(row, f);
    if (row.phase !== run.phase) run = { ...run, phase: row.phase };
  }
  for (const m of members) if (m.state === SpireMemberState.In && here.has(hex(m.identity))) inside.add(hex(m.identity));
  writeFight(ctx, stored, row);
  if (!sameRowShallow(run0, run)) ctx.db.lanternRun.id.update(run);
}

/** Lobby upkeep, Active runs, cleanup and the stranded sweep (after phaseSpire in the tick). */
export function phaseLantern(t: BossTick): void {
  const { ctx, T } = t;
  if (!ctx.db.lanternRun || !ctx.db.lanternMember || !ctx.db.lanternFight) return;
  const inside = new Set<string>();
  if (ctx.db.lanternRun.count() > 0n) {
    const cfg = readLanternConfig(ctx);
    const io = tickIo(t);
    const runs = [...ctx.db.lanternRun.iter()].sort((a, b) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const run of runs) {
      const live = run.stage === SpireStage.Lobby || run.stage === SpireStage.Active;
      if (live && run.rules !== LANTERN_RULES_VERSION) { lanternReset(ctx, T, io, run); continue; }
      if (run.stage === SpireStage.Lobby) {
        if (!cfg.lanternOpen) dissolveLobby(ctx, run, LANTERN_CLOSED_MESSAGE);
        else lobbyUpkeep(t, run);
      } else if (run.stage === SpireStage.Active) {
        // configure_lanternmaw already failed (and refunded) every run when the switch went off.
        if (!cfg.lanternOpen) failRun(ctx, T, io, run, ctx.db.lanternFight.runId.find(run.id), SpireOutcome.Closed, false);
        else stepRun(t, io, run, inside);
      } else if (T >= run.endTick) {
        deleteRun(ctx, run.id);
      }
    }
  }
  // Stranded sweep: nobody stands on the floor without a present In membership of an Active run.
  for (const h of t.order) {
    const p = t.players.get(h);
    if (!p || inside.has(h) || !p.online || p.state !== PlayerState.Alive || !onLanternFloor(p)) continue;
    lanternEject(p, Math.max(p.hp, LANTERN_KO_HP), T);
    t.mark(p);
  }
}

function lanternReset(ctx: Ctx, T: number, io: PlayerIo, run: LanternRunRow): void {
  if (run.stage === SpireStage.Active) failRun(ctx, T, io, run, ctx.db.lanternFight.runId.find(run.id), SpireOutcome.Reset, true);
  else dissolveLobby(ctx, run, LANTERN_UPDATED_MESSAGE);
}

// ---- Owner effects and helpers shared with the reducers -------------------------------------------------------------

/** Owner close: lobbies deleted (members told), Active runs fail with Closed and refund bait and fee. */
export function lanternClose(ctx: Ctx, T: number): void {
  if (!ctx.db.lanternRun || ctx.db.lanternRun.count() === 0n) return;
  const io = directIo(ctx);
  for (const run of [...ctx.db.lanternRun.iter()]) {
    if (run.stage === SpireStage.Lobby) dissolveLobby(ctx, run, LANTERN_CLOSED_MESSAGE);
    else if (run.stage === SpireStage.Active) failRun(ctx, T, io, run, ctx.db.lanternFight.runId.find(run.id), SpireOutcome.Closed, true);
  }
}

/** Why `p` cannot take part: lanternEntryRejection on its bag, coins and wielded weapon. */
export function lanternEntryProblem(ctx: Ctx, p: PlayerRow): string | null {
  return lanternEntryRejection(readSlots(ctx, p.identity).slots, lanternCoins(ctx, p.identity), p.weapon);
}

export interface LanternStartIo {
  player(hex: string): PlayerRow | undefined;
  save(p: PlayerRow): void;
  others(): Iterable<PlayerRow>;
}

/**
 * Start effects: per member spend one Fen Bait and the 5-coin fee, clear interactions, cancel trades, clear
 * combat targets on them, end grace, teleport to LANTERN_SPAWNS[slot], state In; run Active with
 * startTick = T + 5; insert lantern_fight with the first den pattern published; boss_event LanternRunStart.
 */
export function lanternStartRun(ctx: Ctx, T: number, run: LanternRunRow, members: readonly LanternMemberRow[], io: LanternStartIo): void {
  const sorted = [...members].sort((a, b) => a.slot - b.slot);
  const ids = new Set(sorted.map((m) => hex(m.identity)));
  const startTick = T + LANTERN_INTRO_TICKS;
  const spawns: number[] = [];
  const payers: Identity[] = [];
  for (const m of sorted) {
    const p = io.player(hex(m.identity));
    if (!p) continue;
    spend(ctx, p.identity, LANTERN_BAIT.itemId, 1);
    payers.push(p.identity);
    clearInteractions(ctx, p);
    for (const trade of tradesOf(ctx, p.identity)) cancelTrade(ctx, trade, 'Trade cancelled: they went down into the Drowned Hollow');
    p.respawnTick = Math.min(p.respawnTick, Math.max(0, T - RESPAWN_GRACE_TICKS));
    const spawn = LANTERN_SPAWNS[m.slot] ?? LANTERN_SPAWNS[0];
    const at: Tile = lanternTile(spawn);
    p.x = at.x; p.z = at.z;
    io.save(p);
    spawns.push(spawn);
    writeMember(ctx, { ...m, state: SpireMemberState.In, awaySinceTick: 0, awayCount: 0, meals: 0 });
  }
  moveCoins(ctx, payers, -LANTERN_ENTRY_FEE, run.id, 'fee:lanternmaw');
  for (const q of io.others()) {
    if (ids.has(hex(q.identity)) || !q.combatTarget || !ids.has(hex(q.combatTarget))) continue;
    const next = { ...q, combatTarget: undefined, hostile: false };
    if (q.pending === Pending.Trade) { next.pending = Pending.None; next.pendingId = 0n; next.targetX = undefined; next.targetZ = undefined; }
    io.save(next);
  }
  const n = sorted.length;
  const cfg = readLanternConfig(ctx);
  const maxHp = lanternMaxHp(n, cfg.lanternHpBase, cfg.lanternHpPerMember);
  ctx.db.lanternRun.id.update({
    ...run, stage: SpireStage.Active, outcome: SpireOutcome.None, partySize: n, startTick, endTick: startTick + LANTERN_TIME_LIMIT, phase: 1, clearTicks: 0,
  });
  if (ctx.db.lanternFight.runId.find(run.id)) ctx.db.lanternFight.runId.delete(run.id);
  const f = lanternFreshFight(lanternSeed(run.id, startTick), n, startTick, spawns, maxHp);
  ctx.db.lanternFight.insert({ runId: run.id, ...f, ...lanternEmptySlots() });
  emitBossEvent(ctx, { tick: T, boss: BossId.Lanternmaw, kind: BossEventKind.LanternRunStart, runId: run.id, quantity: n, x: LANTERN_GATE.x, z: LANTERN_GATE.z });
}

/** Owner debug ops: lantern_hp (percent of an Active run), lantern_fail_all (refunds), lantern_soon (announce, value = minutes). */
export const LANTERN_DEBUG_OPS: readonly string[] = ['lantern_hp', 'lantern_fail_all', 'lantern_soon'];
export function lanternDebug(ctx: Ctx, T: number, op: string, runId: bigint, value: number): void {
  if (op === 'lantern_soon') {
    emitBossEvent(ctx, { tick: T, boss: BossId.Lanternmaw, kind: BossEventKind.LanternSoon, value, x: LANTERN_GATE.x, z: LANTERN_GATE.z });
    return;
  }
  if (op === 'lantern_fail_all') {
    const io = directIo(ctx);
    for (const run of [...ctx.db.lanternRun.iter()]) {
      if (run.stage === SpireStage.Active) failRun(ctx, T, io, run, ctx.db.lanternFight.runId.find(run.id), SpireOutcome.Closed, true);
    }
    return;
  }
  if (op !== 'lantern_hp') throw new SenderError('This debug action does not exist');
  const run = ctx.db.lanternRun.id.find(runId);
  const f = ctx.db.lanternFight.runId.find(runId);
  if (!run || run.stage !== SpireStage.Active || !f) throw new SenderError('This run is not active');
  ctx.db.lanternFight.runId.update({ ...f, hp: Math.min(f.maxHp, Math.max(1, Math.floor((f.maxHp * value) / 100))) });
}

/** Deletes a stale or Left row and returns null, or the refusal. Also refuses a live Spire party. */
export function lanternMembershipProblem(ctx: Ctx, me: PlayerRow, T: number): string | null {
  const m = ctx.db.lanternMember.identity.find(me.identity);
  if (m) {
    const run = ctx.db.lanternRun.id.find(m.runId);
    if (!run || run.stage === SpireStage.Cleared || run.stage === SpireStage.Failed
      || (run.stage === SpireStage.Active && m.state === SpireMemberState.Left)) {
      ctx.db.lanternMember.identity.delete(me.identity);
    } else if (run.stage === SpireStage.Active && m.state === SpireMemberState.Out) {
      const s = Math.max(0, Math.ceil((run.endTick - T) * 0.6));
      return `You still belong to a party that is fighting (${s} s left); leave it to give up its reward`;
    } else {
      return 'You are already in a Lanternmaw party';
    }
  }
  return null;
}

/** True while `id` is in a live Lanternmaw party (a lobby, or an Active run as In or Out): blocks a Spire party. */
export function inLanternParty(ctx: Ctx, id: Identity): boolean {
  const live = lanternLiveMembership(ctx, id);
  return !!live;
}

export function lanternLiveMembership(ctx: Ctx, id: Identity): { m: LanternMemberRow; run: LanternRunRow } | null {
  const m = ctx.db.lanternMember?.identity.find(id);
  if (!m) return null;
  const run = ctx.db.lanternRun.id.find(m.runId);
  if (!run) return null;
  if (run.stage === SpireStage.Lobby) return { m, run };
  if (run.stage === SpireStage.Active && (m.state === SpireMemberState.In || m.state === SpireMemberState.Out)) return { m, run };
  return null;
}

export function lanternLeaveLobby(ctx: Ctx, run: LanternRunRow, id: Identity): void {
  ctx.db.lanternMember.identity.delete(id);
  const rest = membersOf(ctx, run.id);
  if (rest.length === 0) { ctx.db.lanternRun.id.delete(run.id); return; }
  const leads = hex(run.leader) !== hex(id);
  ctx.db.lanternRun.id.update({ ...run, partySize: rest.length, leader: leads ? run.leader : rest[0].identity });
}

/** lantern_leave during a run: In -> Left (ejected, no reward, no result); Out -> the row goes. */
export function lanternForfeit(ctx: Ctx, T: number, m: LanternMemberRow, p: PlayerRow): void {
  if (m.state === SpireMemberState.Out) { ctx.db.lanternMember.identity.delete(m.identity); return; }
  writeMember(ctx, { ...m, state: SpireMemberState.Left, awaySinceTick: 0 });
  if (onLanternFloor(p)) lanternEject(p, Math.max(p.hp, 1), T);
}

export function lanternMembers(ctx: Ctx, runId: bigint): LanternMemberRow[] {
  return membersOf(ctx, runId);
}
