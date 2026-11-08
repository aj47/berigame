import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  BossEventKind, BossId, LANTERN_CONFIG_ID, LANTERN_GATE, LANTERN_GATE_RANGE, LANTERN_LOBBY_TICKS, LANTERN_MAX_LOBBIES,
  LANTERN_MAX_PARTY, LANTERN_RULES_VERSION, PlayerState, SpireMemberState, SpireOutcome, SpireStage, chebyshev,
  lanternConfigProblem, type LanternConfigLike,
} from '../../../shared/sim';
import { requireOwner } from '../lib/access';
import { carrying, duelFor } from '../lib/adventure';
import { activePlayers } from '../lib/activePlayers';
import { activityAction } from '../lib/activity';
import {
  lanternClose, lanternEntryProblem, lanternForfeit, lanternLeaveLobby, lanternLiveMembership, lanternMembers,
  lanternMembershipProblem, lanternStartRun, readLanternConfig,
} from '../lib/lantern';
import { currentTick, hex, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { emitBossEvent } from '../lib/rows';
import { spireLiveMembership } from '../lib/spire';
import { loadPlayer } from '../lib/playerStore';
import type { Ctx, LanternRunRow, PlayerRow } from '../lib/types';

/**
 * Lanternmaw's party reducers (docs/design/BOSSES.md section 9.2), the Spire's
 * shape: public lobbies at the Fen Gate, 1-4 members, the leader starts. Each
 * member needs a stone club or better, one Fen Bait and 5 coins
 * (`lanternEntryRejection`); bait and fee are spent at the start.
 * `clientRules` is the caller's LANTERN_RULES_VERSION.
 */

const SEALED = 'The Drowned Hollow is sealed';

function onExpedition(ctx: Ctx, id: Identity): boolean {
  const m = ctx.db.expeditionMember.identity.find(id);
  const e = m && ctx.db.expedition.id.find(m.expeditionId);
  return !!e && (e.stage === 'growing' || e.stage === 'hauling');
}

function begin(ctx: Ctx, clientRules: number): { p: PlayerRow; T: number } {
  const p = requireAlivePlayer(ctx);
  const T = currentTick(ctx);
  touchInput(p, T);
  savePlayer(ctx, p);
  if (clientRules !== LANTERN_RULES_VERSION) throw new SenderError('This client is out of date; reload the page to enter the Drowned Hollow');
  return { p, T };
}

/** Shared by lantern_open and lantern_join: hands free, no duel or expedition, at the gate, no other party, entry. */
function requireReadyAtGate(ctx: Ctx, p: PlayerRow, T: number): void {
  if (carrying(ctx, p.identity)) throw new SenderError('Put down the giant berry first; it needs both hands');
  if (duelFor(ctx, p.identity)) throw new SenderError('You cannot enter the Drowned Hollow during a duel');
  if (onExpedition(ctx, p.identity)) throw new SenderError('You are on an expedition; finish or leave it first');
  if ((p.region || 'bramblewild') !== 'bramblewild' || chebyshev(p, LANTERN_GATE) > LANTERN_GATE_RANGE) {
    throw new SenderError(`Walk to the Fen Gate (${LANTERN_GATE.x},${LANTERN_GATE.z}) first`);
  }
  const problem = lanternMembershipProblem(ctx, p, T);
  if (problem) throw new SenderError(problem);
  if (spireLiveMembership(ctx, p.identity)) throw new SenderError('You are in a Spire party; leave it first');
  const entry = lanternEntryProblem(ctx, p);
  if (entry) throw new SenderError(entry);
}

function lobbyCount(ctx: Ctx): number {
  let n = 0;
  for (const r of ctx.db.lanternRun.iter()) if (r.stage === SpireStage.Lobby) n++;
  return n;
}

/** Open a public Lanternmaw lobby at the Fen Gate (you lead it). */
export const lanternOpen = spacetimedb.reducer(
  { clientRules: t.u32() },
  (ctx, { clientRules }) => {
    const { p, T } = begin(ctx, clientRules);
    if (!readLanternConfig(ctx).lanternOpen) throw new SenderError(SEALED);
    requireReadyAtGate(ctx, p, T);
    if (lobbyCount(ctx) >= LANTERN_MAX_LOBBIES) throw new SenderError('The Fen Gate is crowded; join an open party instead');
    const run = ctx.db.lanternRun.insert({
      id: 0n, leader: p.identity, stage: SpireStage.Lobby, outcome: SpireOutcome.None, rules: LANTERN_RULES_VERSION, partySize: 1,
      createdTick: T, startTick: 0, endTick: T + LANTERN_LOBBY_TICKS, phase: 1, clearTicks: 0,
    });
    ctx.db.lanternMember.insert({ identity: p.identity, runId: run.id, slot: 0, state: SpireMemberState.Lobby, joinedTick: T, awaySinceTick: 0, awayCount: 0, meals: 0 });
  }
);

function newestOpenLobby(ctx: Ctx): LanternRunRow | undefined {
  let best: LanternRunRow | undefined;
  for (const r of ctx.db.lanternRun.iter()) {
    if (r.stage !== SpireStage.Lobby || r.rules !== LANTERN_RULES_VERSION) continue;
    if (lanternMembers(ctx, r.id).length >= LANTERN_MAX_PARTY) continue;
    if (!best || r.createdTick > best.createdTick || (r.createdTick === best.createdTick && r.id > best.id)) best = r;
  }
  return best;
}

/** Join a lobby by run id, or quick-join the newest open lobby with runId 0. */
export const lanternJoin = spacetimedb.reducer(
  { runId: t.u64(), clientRules: t.u32() },
  (ctx, { runId, clientRules }) => {
    const { p, T } = begin(ctx, clientRules);
    if (!readLanternConfig(ctx).lanternOpen) throw new SenderError(SEALED);
    requireReadyAtGate(ctx, p, T);
    let run: LanternRunRow | undefined;
    if (runId === 0n) {
      run = newestOpenLobby(ctx);
      if (!run) throw new SenderError('No open Lanternmaw party is waiting; open one instead');
    } else {
      run = ctx.db.lanternRun.id.find(runId) ?? undefined;
      if (!run) throw new SenderError('This party is gone');
    }
    if (run.stage !== SpireStage.Lobby) throw new SenderError('This party has already gone down');
    if (run.rules !== LANTERN_RULES_VERSION) throw new SenderError('This party is from an older Drowned Hollow; open a new one');
    const members = lanternMembers(ctx, run.id);
    if (members.length >= LANTERN_MAX_PARTY) throw new SenderError('This party is full');
    const used = new Set(members.map((m) => m.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    ctx.db.lanternMember.insert({ identity: p.identity, runId: run.id, slot, state: SpireMemberState.Lobby, joinedTick: T, awaySinceTick: 0, awayCount: 0, meals: 0 });
    ctx.db.lanternRun.id.update({ ...run, partySize: members.length + 1 });
  }
);

/** Leave a lobby, or forfeit a run (no rewards). */
export const lanternLeave = spacetimedb.reducer((ctx) => {
  const p = requireAlivePlayer(ctx);
  const T = currentTick(ctx);
  touchInput(p, T);
  const live = lanternLiveMembership(ctx, p.identity);
  if (!live) { savePlayer(ctx, p); throw new SenderError('You are not in a Lanternmaw party'); }
  const { m, run } = live;
  if (run.stage === SpireStage.Lobby) lanternLeaveLobby(ctx, run, p.identity);
  else lanternForfeit(ctx, T, m, p);
  savePlayer(ctx, p);
});

/** The leader starts the run: every member's bait and fee are spent and the party goes down. */
export const lanternStart = spacetimedb.reducer(
  { clientRules: t.u32() },
  (ctx, { clientRules }) => {
    const { p, T } = begin(ctx, clientRules);
    const mine = ctx.db.lanternMember.identity.find(p.identity);
    const run = mine && ctx.db.lanternRun.id.find(mine.runId);
    if (!run || !sameId(run.leader, p.identity)) throw new SenderError('You are not leading a Lanternmaw party');
    if (run.stage !== SpireStage.Lobby) throw new SenderError('This party has already gone down');
    const cfg = readLanternConfig(ctx);
    if (!cfg.lanternOpen) throw new SenderError(SEALED);
    const members = lanternMembers(ctx, run.id);
    for (const m of members) {
      const q = sameId(m.identity, p.identity) ? p : loadPlayer(ctx, m.identity);
      const waiting = (why: string) => new SenderError(`This party is waiting for ${q?.name ?? 'a member'}: ${why}`);
      if (!q || !q.online || q.state !== PlayerState.Alive) throw waiting('they are away');
      if ((q.region || 'bramblewild') !== 'bramblewild') throw waiting('they left Bramblewild');
      if (chebyshev(q, LANTERN_GATE) > LANTERN_GATE_RANGE) throw waiting('walk to the gate');
      const entry = lanternEntryProblem(ctx, q);
      if (entry) throw waiting(entry);
      if (carrying(ctx, q.identity)) throw waiting('is carrying the giant berry');
      if (duelFor(ctx, q.identity)) throw waiting('is in a duel');
      if (onExpedition(ctx, q.identity)) throw waiting('is on an expedition');
    }
    let active = 0;
    for (const r of ctx.db.lanternRun.iter()) if (r.stage === SpireStage.Active) active++;
    if (active >= cfg.lanternMaxRuns) throw new SenderError('The Drowned Hollow is full right now. Try again in a minute');
    const me = hex(p.identity);
    lanternStartRun(ctx, T, run, members, {
      player: (h) => {
        if (h === me) return p;
        const row = members.find((m) => hex(m.identity) === h);
        const q = row && loadPlayer(ctx, row.identity);
        return q ? { ...q } : undefined;
      },
      save: (q) => savePlayer(ctx, q),
      others: () => activePlayers(ctx),
    });
    for (const m of members) activityAction(ctx, m.identity, 'lantern-run');
  }
);

/**
 * World-owner switch for Lanternmaw (BOSSES.md 9.11): its own reducer and row, so the Clatterhorn/Spire
 * `configure_bosses` call and its kill switch keep their arguments. Opening announces the launch
 * (boss_event LanternOpened); a closed Hollow is closed again every time (lobbies go, Active runs fail
 * with bait and fee refunded).
 */
export const configureLanternmaw = spacetimedb.reducer(
  { lanternOpen: t.bool(), lanternMaxRuns: t.u8(), lanternHpBase: t.u32(), lanternHpPerMember: t.u32() },
  (ctx, args) => {
    requireOwner(ctx);
    const cfg: LanternConfigLike = {
      lanternOpen: args.lanternOpen, lanternMaxRuns: args.lanternMaxRuns, lanternHpBase: args.lanternHpBase, lanternHpPerMember: args.lanternHpPerMember,
    };
    const problem = lanternConfigProblem(cfg);
    if (problem) throw new SenderError(problem);
    const T = currentTick(ctx);
    const before = readLanternConfig(ctx);
    const row = { id: LANTERN_CONFIG_ID, ...cfg };
    if (ctx.db.lanternConfig.id.find(LANTERN_CONFIG_ID)) ctx.db.lanternConfig.id.update(row); else ctx.db.lanternConfig.insert(row);
    if (!before.lanternOpen && cfg.lanternOpen) {
      emitBossEvent(ctx, { tick: T, boss: BossId.Lanternmaw, kind: BossEventKind.LanternOpened, x: LANTERN_GATE.x, z: LANTERN_GATE.z });
    }
    if (!cfg.lanternOpen) lanternClose(ctx, T);
  }
);
