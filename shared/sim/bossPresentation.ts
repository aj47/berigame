/**
 * One presenter for the agent API's /state boss blocks and WebMCP's
 * inspect_game_state, so they cannot drift (FINAL_SPEC 6.8, 8.2; CORE_SCOPE:
 * no practice, private lobbies, queue or downed fields).
 *
 * Pure: rows in, plain JSON out. Sizes stay under 2 KB (`state.clatterhorn`)
 * and 4 KB (`state.spire`).
 */
import type { BossConfigLike } from './bossConfig';
import {
  CLATTER_DIR_NAMES, SPIRE_MEMBER_STATE_NAMES, SPIRE_OUTCOME_NAMES, SPIRE_STAGE_NAMES, clatterBaitId, clatterTelegraphView,
  spireLiveStars,
} from './bossDanger';
import { CLATTER_GLADE, CLATTER_HOME, CLATTER_STONES, SPIRE_CENTRE, SPIRE_EXIT, SPIRE_GATE, SPIRE_GATE_RANGE, inClatterGlade, inSpireFloor } from './bossZones';
import {
  CLATTER_CHALLENGER_CAP, CLATTER_DAMAGE, CLATTER_LONELY_TICKS, CLATTER_MIN_CONTRIBUTION, CLATTER_REACH, CLATTER_RECENT_TICKS,
  CLATTER_RESPAWN_TICKS, CLATTER_REWARD, CLATTER_STATE_NAMES, CLATTER_SWARM_TICKS, ClatterState, clatterAttackable, clatterFrenzy,
  clatterPhase, clatterSwarmFreeLines, type ClatterRowLike,
} from './clatterhorn';
import { SPIRE_KEY_ITEM_ID, getItemDef } from './items';
import { getRecipe } from './nodes';
import { getCosmetic } from './skills';
import {
  SPIRE_BOSS_NAME, SPIRE_ENRAGE_TICKS, SPIRE_MAX_PARTY, SPIRE_MEALS, SPIRE_MIN_STARS, SPIRE_PATTERNS,
  SPIRE_PHASE_NAMES, SPIRE_RANGE, SPIRE_REWARD, SPIRE_RULES_VERSION, SPIRE_STAR_DAMAGE, SPIRE_TIME_LIMIT, SpireStage,
  spireBulletDamage, spireEnraged, spireSlot, type SpireFightLike, type SpireMemberLike, type SpireRunLike,
} from './spire';

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
const tile = (t: { x: number; z: number }) => ({ x: t.x, z: t.z });
const SWARM_SIDES = ['north', 'east', 'south', 'west'] as const;

const cosmeticKey = (id: number) => getCosmetic(id)?.key ?? null;
const itemName = (id: string) => getItemDef(id)?.name ?? id;

/** Kept short: `state.clatterhorn` must stay under 2 KB with a 79-tile charge lane. */
const CLATTER_RULE = (cfg: BossConfigLike) =>
  `PvE boss; no PvP in the glade. Wakes when someone enters it; resets after ${CLATTER_LONELY_TICKS} ticks alone. attack_clatterhorn within `
  + `Chebyshev ${CLATTER_REACH} of its centre. Blows hit telegraph.tiles when landsInTicks reaches 0; runners skip swarm.freeLines; a "flip" `
  + `end doubles damage while flipped. HP ${cfg.clatterHpBase} + ${cfg.clatterHpPerChallenger} per challenger (cap ${CLATTER_CHALLENGER_CAP}). `
  + `Pays everyone with reward.minDamage this fight and a swing in the last reward.recentTicks; then burrows ${CLATTER_RESPAWN_TICKS} ticks. `
  + `Safe moves: GET /api/agent/v1/danger.`;

/** `state.clatterhorn` (null without a row; the caller passes null outside Bramblewild). */
/**
 * `world.blocked` is the world's blocked set (the stable Set /danger gets) and `world.maxSteps` your tiles per
 * tick, so `telegraph.escape` lists the same tiles as GET /danger.
 */
export function describeClatterhorn(row: ClatterRowLike | null, cfg: BossConfigLike, me: { x: number; z: number; identity: string },
  tick: number, contribution: number | null, world: { blocked: Set<number>; maxSteps?: 1 | 2 }): Record<string, unknown> | null {
  if (!row) return null;
  const closed = row.state === ClatterState.Closed || !cfg.clatterhornOpen;
  const awake = clatterAttackable(row);
  const tv = clatterTelegraphView(row, me, tick, world.blocked, world.maxSteps ?? 2);
  const drum = row.state === ClatterState.DrumWindup || row.state === ClatterState.Drumming;
  const fire = row.state === ClatterState.DrumWindup ? row.stateUntilTick : row.swarmTick;
  const damage = Math.max(0, contribution ?? 0);
  return {
    open: !closed,
    state: CLATTER_STATE_NAMES[row.state] ?? 'closed',
    tile: tile(row), home: tile(CLATTER_HOME), body: 1, reach: CLATTER_REACH,
    glade: { ...CLATTER_GLADE },
    stones: CLATTER_STONES.map((s) => [s.x, s.z]),
    health: row.hp, maxHealth: row.maxHp, challengers: row.challengers,
    phase: awake ? clatterPhase(row, tick) : row.phase,
    frenzy: awake && clatterFrenzy(row, tick),
    flipped: row.state === ClatterState.Flipped ? { endsInTicks: Math.max(0, row.stateUntilTick - tick), damageMultiplier: 2 } : null,
    bait: row.state === ClatterState.ChargeWindup ? clatterBaitId(row.bait, me.identity) : null,
    telegraph: tv ? {
      attack: tv.view.attack, landsInTicks: tv.view.landsInTicks, damage: tv.view.damage,
      dir: tv.tel.attack === 'charge' ? CLATTER_DIR_NAMES[tv.tel.dir & 7] : null,
      from: tile(tv.tel.from), to: tile(tv.tel.to), end: tv.view.end,
      tiles: tv.view.tiles, youAreInside: tv.view.youAreInside, escape: tv.view.escape,
    } : null,
    swarm: drum && fire > 0 ? {
      side: SWARM_SIDES[row.swarmSide & 3],
      firesInTicks: Math.max(0, fire - tick),
      activeUntilTick: row.state === ClatterState.DrumWindup ? fire + CLATTER_SWARM_TICKS : row.stateUntilTick,
      axis: (row.swarmSide & 1) === 0 ? 'x' : 'z',
      freeLines: clatterSwarmFreeLines(row),
      damage: CLATTER_DAMAGE.runner, tilesPerTick: 1,
    } : null,
    returnsInTicks: row.state === ClatterState.Burrowed ? Math.max(0, row.stateUntilTick - tick) : 0,
    resetInTicks: row.state === ClatterState.Idle && row.stateUntilTick > 0 ? Math.max(0, row.stateUntilTick - tick) : null,
    you: {
      contribution: damage, qualified: damage >= CLATTER_MIN_CONTRIBUTION,
      inGlade: inClatterGlade(me), inReach: awake && cheb(me, row) <= CLATTER_REACH,
    },
    reward: {
      items: CLATTER_REWARD.items.map((i) => ({ ...i })), fightingXp: CLATTER_REWARD.fightingXp,
      minDamage: CLATTER_MIN_CONTRIBUTION, recentTicks: CLATTER_RECENT_TICKS, keepsake: cosmeticKey(CLATTER_REWARD.keepsake),
    },
    rule: CLATTER_RULE(cfg),
  };
}

/** Lobbies listed in `state.spire.lobbies`. */
export const SPIRE_LOBBY_LIST_MAX = 10;
const KEY_ID = SPIRE_KEY_ITEM_ID;

const SPIRE_RULE =
  `Bullet-hell dungeon for 1-${SPIRE_MAX_PARTY}. Gather within ${SPIRE_GATE_RANGE} of the gate; open or join a lobby, then the leader starts `
  + `(every member spends one ${KEY_ID}). Inside, read GET /api/agent/v1/danger every tick and dodge {x,z}. Stars deal ${SPIRE_STAR_DAMAGE} each `
  + `(catch ${SPIRE_MIN_STARS}+ for the reward); within ${SPIRE_RANGE} of the dais your weapon swings by itself. Enrage at ${SPIRE_ENRAGE_TICKS} ticks, `
  + `timeout at ${SPIRE_TIME_LIMIT}. At most ${SPIRE_MEALS} meals per run. At 0 HP you are knocked out to the exit with your bag; you keep credit for a clear.`;

type SpireRunInput = SpireRunLike & { leader?: string | { toHexString(): string } | null };

const hexOf = (v: SpireRunInput['leader']): string | null =>
  v == null ? null : typeof v === 'string' ? v : typeof v.toHexString === 'function' ? v.toHexString() : null;

/** `state.spire`, including `run` while you belong to a run that has started and still exists. */
export function describeSpire(input: {
  cfg: BossConfigLike;
  runs: readonly SpireRunLike[];
  members: readonly (SpireMemberLike & { identity: string })[];
  fight: SpireFightLike | null;
  me: { identity: string; x: number; z: number };
  tick: number;
  keysHeld: number;
  name(hex: string): string | null;
  player(hex: string): { x: number; z: number; hp: number } | null;
}): Record<string, unknown> {
  const { cfg, members, fight, me, tick } = input;
  const runs = input.runs as readonly SpireRunInput[];
  const runOf = new Map(runs.map((r) => [r.id, r]));
  const membersOf = (id: bigint) => members.filter((m) => m.runId === id).sort((a, b) => a.slot - b.slot);
  const leaderOf = (r: SpireRunInput) => hexOf(r.leader) ?? membersOf(r.id)[0]?.identity ?? null;

  let active = 0, lobbies = 0, inside = 0;
  for (const r of runs) {
    if (r.stage === SpireStage.Active) active++;
    else if (r.stage === SpireStage.Lobby) lobbies++;
  }
  for (const m of members) {
    if (runOf.get(m.runId)?.stage !== SpireStage.Active) continue;
    const p = input.player(m.identity);
    if (p && inSpireFloor(p)) inside++;
  }

  const lobbyList = runs.filter((r) => r.stage === SpireStage.Lobby && r.isPublic)
    .sort((a, b) => b.createdTick - a.createdTick || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0))
    .slice(0, SPIRE_LOBBY_LIST_MAX)
    .map((r) => {
      const leader = leaderOf(r);
      return {
        runId: String(r.id), leader, leaderName: leader ? input.name(leader) : null, members: r.partySize,
        closesInTicks: Math.max(0, r.endTick - tick),
        ...(r.rules !== SPIRE_RULES_VERSION ? { outdated: true } : {}),
      };
    });

  const mine = members.find((m) => m.identity === me.identity) ?? null;
  const myRun = mine ? runOf.get(mine.runId) ?? null : null;
  const recipe = getRecipe(KEY_ID);

  return {
    open: cfg.spireOpen,
    rulesVersion: SPIRE_RULES_VERSION,
    gate: tile(SPIRE_GATE), exit: tile(SPIRE_EXIT), joinRange: SPIRE_GATE_RANGE,
    atGate: cheb(me, SPIRE_GATE) <= SPIRE_GATE_RANGE,
    key: { itemId: KEY_ID, held: Math.max(0, input.keysHeld), inputs: (recipe?.inputs ?? []).map((i) => ({ ...i })) },
    capacity: { active, max: cfg.spireMaxRuns, lobbies, inside },
    lobbies: lobbyList,
    you: mine && myRun ? {
      runId: String(myRun.id), stage: SPIRE_STAGE_NAMES[myRun.stage] ?? 'unknown', state: SPIRE_MEMBER_STATE_NAMES[mine.state] ?? 'unknown',
      slot: mine.slot, leader: leaderOf(myRun) === me.identity,
    } : null,
    run: mine && myRun && fight && myRun.stage >= SpireStage.Active ? describeRun(myRun, fight, membersOf(myRun.id), input) : null,
    reward: {
      items: SPIRE_REWARD.items.map((i) => ({ ...i, name: itemName(i.itemId) })), fightingXp: SPIRE_REWARD.fightingXp, minStars: SPIRE_MIN_STARS,
      keepsake: cosmeticKey(SPIRE_REWARD.crown), flawlessKeepsake: cosmeticKey(SPIRE_REWARD.pendant),
    },
    rule: SPIRE_RULE,
  };
}

function describeRun(run: SpireRunInput, fight: SpireFightLike, members: readonly (SpireMemberLike & { identity: string })[], input: {
  tick: number; name(hex: string): string | null; player(hex: string): { x: number; z: number; hp: number } | null;
}): Record<string, unknown> {
  const { tick } = input;
  const active = run.stage === SpireStage.Active;
  const enraged = active && spireEnraged(run.startTick, tick);
  const live = spireLiveStars(run, fight, tick + 1);
  const nextTick = live ? live.nextTick : run.startTick;
  return {
    runId: String(run.id),
    stage: SPIRE_STAGE_NAMES[run.stage] ?? 'unknown',
    outcome: run.outcome ? SPIRE_OUTCOME_NAMES[run.outcome] ?? 'unknown' : null,
    boss: {
      name: SPIRE_BOSS_NAME, health: fight.hp, maxHealth: fight.maxHp, phase: fight.phase, phaseName: SPIRE_PHASE_NAMES[fight.phase] ?? '',
      pattern: SPIRE_PATTERNS[fight.curKind]?.key ?? null, enraged,
    },
    startsInTicks: active ? Math.max(0, run.startTick - tick) : 0,
    timeLeftTicks: active ? Math.max(0, run.endTick - tick) : 0,
    enrageInTicks: active ? Math.max(0, run.startTick + SPIRE_ENRAGE_TICKS - tick) : 0,
    hitDamage: spireBulletDamage(fight.phase, enraged),
    ...(run.stage === SpireStage.Cleared ? { clearTicks: run.clearTicks } : {}),
    court: { center: tile(SPIRE_CENTRE), range: SPIRE_RANGE },
    stars: active ? {
      wave: live ? live.wave : -1,
      live: live ? live.stars.map((s) => ({ x: s.x, z: s.z, ticksLeft: live.lastTick - tick })) : [],
      nextInTicks: nextTick < run.endTick ? Math.max(1, nextTick - tick) : null,
    } : null,
    members: members.map((m) => {
      const p = input.player(m.identity);
      return {
        playerId: m.identity, name: input.name(m.identity), slot: m.slot, state: SPIRE_MEMBER_STATE_NAMES[m.state] ?? 'unknown',
        health: p ? p.hp : null, tile: p ? tile(p) : null,
        stars: spireSlot(fight, 'stars', m.slot), hits: spireSlot(fight, 'hits', m.slot), meals: m.meals, away: m.awaySinceTick > 0,
      };
    }),
    danger: '/api/agent/v1/danger',
  };
}
