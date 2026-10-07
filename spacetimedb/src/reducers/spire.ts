import { t, SenderError } from 'spacetimedb/server';
import type { Identity } from 'spacetimedb';
import spacetimedb from '../schema';
import {
  PlayerState, SPIRE_GATE, SPIRE_GATE_RANGE, SPIRE_KEY_ITEM_ID, SPIRE_LOBBY_TICKS, SPIRE_MAX_LOBBIES, SPIRE_MAX_PARTY,
  SPIRE_RULES_VERSION, SpireMemberState, SpireMode, SpireOutcome, SpireStage, chebyshev, countItem,
} from '../../../shared/sim';
import { carrying, duelFor } from '../lib/adventure';
import { readSlots } from '../lib/inventory';
import { currentTick, hex, requireAlivePlayer, sameId, savePlayer, touchInput } from '../lib/players';
import { readBossConfig } from '../lib/rows';
import {
  spireForfeit, spireLeaveLobby, spireLiveMembership, spireMembers, spireMembershipProblem, spireStartRun,
} from '../lib/spire';
import type { Ctx, PlayerRow, SpireRunRow } from '../lib/types';

/**
 * The Sunken Spire's party reducers (FINAL_SPEC 5.1 with the CORE_SCOPE cuts:
 * every lobby is public, no practice runs, no kick, no queue). `clientRules`
 * is the caller's SPIRE_RULES_VERSION: an older bundle is refused.
 */

const SEALED = 'The Sunken Spire is sealed';
const NEED_KEY = 'You need a spire key (3 obsidian and 1 gleamshell)';

function hasKey(ctx: Ctx, id: Identity): boolean {
  return countItem(readSlots(ctx, id).slots, SPIRE_KEY_ITEM_ID) > 0;
}

/** A member of an expedition that is still underway ('growing' or 'hauling'); finished ones linger and do not count. */
function onExpedition(ctx: Ctx, id: Identity): boolean {
  const m = ctx.db.expeditionMember.identity.find(id);
  const e = m && ctx.db.expedition.id.find(m.expeditionId);
  return !!e && (e.stage === 'growing' || e.stage === 'hauling');
}

/** Steps 1-3 of spire_open/join/start: an alive Bramblewild player, the input budget, the client's rules version. */
function begin(ctx: Ctx, clientRules: number): { p: PlayerRow; T: number } {
  const p = requireAlivePlayer(ctx);
  const T = currentTick(ctx);
  touchInput(p, T);
  savePlayer(ctx, p);
  if (clientRules !== SPIRE_RULES_VERSION) throw new SenderError('This client is out of date; reload the page to enter the Spire');
  return { p, T };
}

/** Steps 5-9 of spire_open (shared with spire_join). */
function requireReadyAtGate(ctx: Ctx, p: PlayerRow, T: number): void {
  if (carrying(ctx, p.identity)) throw new SenderError('Put down the giant berry first; it needs both hands');
  if (duelFor(ctx, p.identity)) throw new SenderError('You cannot enter the Spire during a duel');
  if (onExpedition(ctx, p.identity)) throw new SenderError('You are on an expedition; finish or leave it first');
  if (chebyshev(p, SPIRE_GATE) > SPIRE_GATE_RANGE) throw new SenderError(`Walk to the Sunken Spire gate (${SPIRE_GATE.x},${SPIRE_GATE.z}) first`);
  const problem = spireMembershipProblem(ctx, p, T);
  if (problem) throw new SenderError(problem);
}

function lobbyCount(ctx: Ctx): number {
  let n = 0;
  for (const r of ctx.db.spireRun.iter()) if (r.stage === SpireStage.Lobby || r.stage === SpireStage.Queued) n++;
  return n;
}

/** Open a public lobby at the Spire Gate (you lead it; you need a spire_key). */
export const spireOpen = spacetimedb.reducer(
  { clientRules: t.u32() },
  (ctx, { clientRules }) => {
    const { p, T } = begin(ctx, clientRules);
    if (!readBossConfig(ctx).spireOpen) throw new SenderError(SEALED);
    requireReadyAtGate(ctx, p, T);
    if (!hasKey(ctx, p.identity)) throw new SenderError(NEED_KEY);
    if (lobbyCount(ctx) >= SPIRE_MAX_LOBBIES) throw new SenderError('The Spire gate is crowded; join an open party instead');
    const run = ctx.db.spireRun.insert({
      id: 0n, leader: p.identity, stage: SpireStage.Lobby, outcome: SpireOutcome.None, mode: SpireMode.Normal, isPublic: true,
      rules: SPIRE_RULES_VERSION, partySize: 1, createdTick: T, queuedTick: 0, startTick: 0, endTick: T + SPIRE_LOBBY_TICKS,
      phase: 1, clearTicks: 0,
    });
    ctx.db.spireMember.insert({
      identity: p.identity, runId: run.id, slot: 0, state: SpireMemberState.Lobby, joinedTick: T,
      awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0,
    });
  }
);

/** The newest open public lobby with a free slot and this rules version (quick join). */
function newestOpenLobby(ctx: Ctx): SpireRunRow | undefined {
  let best: SpireRunRow | undefined;
  for (const r of ctx.db.spireRun.iter()) {
    if (r.stage !== SpireStage.Lobby || !r.isPublic || r.mode !== SpireMode.Normal || r.rules !== SPIRE_RULES_VERSION) continue;
    if (spireMembers(ctx, r.id).length >= SPIRE_MAX_PARTY) continue;
    if (!best || r.createdTick > best.createdTick || (r.createdTick === best.createdTick && r.id > best.id)) best = r;
  }
  return best;
}

/** Join a lobby by run id, or quick-join the newest open lobby with runId 0. */
export const spireJoin = spacetimedb.reducer(
  { runId: t.u64(), clientRules: t.u32() },
  (ctx, { runId, clientRules }) => {
    const { p, T } = begin(ctx, clientRules);
    requireReadyAtGate(ctx, p, T);
    let run: SpireRunRow | undefined;
    if (runId === 0n) {
      run = newestOpenLobby(ctx);
      if (!run) throw new SenderError('No open Spire party is waiting; open one instead');
    } else {
      run = ctx.db.spireRun.id.find(runId) ?? undefined;
      if (!run) throw new SenderError('This party is gone');
    }
    if (run.stage === SpireStage.Queued) throw new SenderError('This party is already queued');
    if (run.stage !== SpireStage.Lobby) throw new SenderError('This party has already gone down');
    if (run.rules !== SPIRE_RULES_VERSION) throw new SenderError('This party is from an older Spire; open a new one');
    if (!readBossConfig(ctx).spireOpen || run.mode !== SpireMode.Normal) throw new SenderError(SEALED);
    const members = spireMembers(ctx, run.id);
    if (members.length >= SPIRE_MAX_PARTY) throw new SenderError('This party is full');
    if (!hasKey(ctx, p.identity)) throw new SenderError(NEED_KEY);
    const used = new Set(members.map((m) => m.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    ctx.db.spireMember.insert({
      identity: p.identity, runId: run.id, slot, state: SpireMemberState.Lobby, joinedTick: T,
      awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0,
    });
    ctx.db.spireRun.id.update({ ...run, partySize: members.length + 1 });
  }
);

/** Leave a lobby, or forfeit a run (no rewards). */
export const spireLeave = spacetimedb.reducer((ctx) => {
  const p = requireAlivePlayer(ctx);
  const T = currentTick(ctx);
  touchInput(p, T);
  const live = spireLiveMembership(ctx, p.identity);
  if (!live) { savePlayer(ctx, p); throw new SenderError('You are not in a Spire party'); }
  const { m, run } = live;
  if (run.stage === SpireStage.Lobby || run.stage === SpireStage.Queued) spireLeaveLobby(ctx, run, p.identity);
  else spireForfeit(ctx, T, m, p);
  savePlayer(ctx, p);
});

/** The leader starts the run: every member's key is spent and the party descends. */
export const spireStart = spacetimedb.reducer(
  { clientRules: t.u32() },
  (ctx, { clientRules }) => {
    const { p, T } = begin(ctx, clientRules);
    const mine = ctx.db.spireMember.identity.find(p.identity);
    const run = mine && ctx.db.spireRun.id.find(mine.runId);
    if (!run || !sameId(run.leader, p.identity)) throw new SenderError('You are not leading a Spire party');
    if (run.stage === SpireStage.Queued) throw new SenderError('This party is already queued');
    if (run.stage !== SpireStage.Lobby) throw new SenderError('This party has already gone down');
    const cfg = readBossConfig(ctx);
    if (!cfg.spireOpen || run.mode !== SpireMode.Normal) throw new SenderError(SEALED);
    const members = spireMembers(ctx, run.id);
    for (const m of members) {
      const q = sameId(m.identity, p.identity) ? p : ctx.db.player.identity.find(m.identity);
      const waiting = (why: string) => new SenderError(`This party is waiting for ${q?.name ?? 'a member'}: ${why}`);
      if (!q || !q.online || q.state !== PlayerState.Alive) throw waiting('they are away');
      // Region before distance: a member in the settlement or at sea has regional x/z that can land near the gate.
      if ((q.region || 'bramblewild') !== 'bramblewild') throw waiting('they left Bramblewild');
      if (chebyshev(q, SPIRE_GATE) > SPIRE_GATE_RANGE) throw waiting('walk to the gate');
      if (run.mode === SpireMode.Normal && !hasKey(ctx, q.identity)) throw waiting('needs a spire key');
      if (carrying(ctx, q.identity)) throw waiting('is carrying the giant berry');
      if (duelFor(ctx, q.identity)) throw waiting('is in a duel');
      if (onExpedition(ctx, q.identity)) throw waiting('is on an expedition');
    }
    // CORE_SCOPE: no queue. A full Spire refuses the start; the lobby stays open until its TTL.
    let active = 0;
    for (const r of ctx.db.spireRun.iter()) if (r.stage === SpireStage.Active) active++;
    if (active >= cfg.spireMaxRuns) throw new SenderError('The Sunken Spire is full right now. Try again in a minute');
    const me = hex(p.identity);
    spireStartRun(ctx, T, run, members, {
      player: (h) => {
        if (h === me) return p;
        const row = members.find((m) => hex(m.identity) === h);
        const q = row && ctx.db.player.identity.find(row.identity);
        return q ? { ...q } : undefined;
      },
      save: (q) => savePlayer(ctx, q),
      others: () => [...ctx.db.player.iter()],
    });
  }
);
