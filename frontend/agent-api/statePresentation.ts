// Shared by the HTTP API and browser WebMCP inspection.
export { describeDestination, describeGathering, describeObjective, describeAction } from '../../shared/sim/agentState';
import {
  BossEventKind, BossId, BossNoticeKind, ClatterState, GRID_SIZE, SPIRE_OUTCOME_NAMES, SPIRE_RULES_VERSION, SpireStage,
  atClatterhorn, bossConfigOr, buildDangerFeed, cargoMovementSteps, chebyshev, clatterHitsMove, dangerMoveTo, describeClatterhorn, describeSpire,
  getCosmetic, getItemDef, inClatterGlade, inSpireFloor, isLandTile, spireFightBullets, spireHitsMove, spireSeesPlayer, spireStandable,
  type BossConfigLike, type ClatterRowLike, type DangerFeed, type DangerMemberInput, type SpireFightLike, type SpireMemberLike,
  type SpireRunLike, type Tile,
} from '../../shared/sim';

/**
 * Boss blocks of /state and WebMCP's inspect_game_state, the danger feed, the dodge check and the boss error
 * codes (FINAL_SPEC 8.2-8.5, 8.7; CORE_SCOPE cuts applied). Pure: the gateway passes its SpacetimeDB cache and
 * the browser its boss store, so HTTP and WebMCP read the same JSON from the same presenters.
 */

type Hex = { toHexString(): string };
/** A player row as far as the boss presenters go (gateway and browser rows both fit). */
export interface BossPlayer extends Tile { identity: Hex; name: string; hp: number; maxHp: number; region?: string; online?: boolean; eatCooldownUntilTick?: number }
export type BossMember = SpireMemberLike & { identity: Hex };
export type BossRun = SpireRunLike & { leader?: Hex | string | null };
export type BossFight = SpireFightLike & { runId: bigint };
/** The boss rows a reader holds: config, Clatterhorn, every run and member, and the fight rows it subscribed. */
export interface BossRows {
  config: BossConfigLike | null | undefined;
  clatter: ClatterRowLike | null | undefined;
  runs: readonly BossRun[];
  members: readonly BossMember[];
  fights: readonly BossFight[];
}

const hexOf = (v: Hex | string) => (typeof v === 'string' ? v : v.toHexString());
export const homeRegion = (p: { region?: string }) => (p.region || 'bramblewild') === 'bramblewild';
/** Standing on the Sunken Spire floor (Bramblewild only: other regions reuse the same x/z numbers). */
export const onSpireFloor = (p: Tile & { region?: string }) => homeRegion(p) && inSpireFloor(p);

/** Your member row, its run, your run's fight row (null until subscribed) and every member of that run. */
export function myRun(rows: BossRows, meHex: string) {
  const members = rows.members;
  const mine = members.find((m) => hexOf(m.identity) === meHex) ?? null;
  if (!mine) return { mine: null, run: null, fight: null, mates: [] as BossMember[] };
  const run = rows.runs.find((r) => r.id === mine.runId) ?? null;
  const fight = rows.fights.find((f) => f.runId === mine.runId) ?? null;
  return { mine, run, fight, mates: members.filter((m) => m.runId === mine.runId) };
}

/**
 * Who a viewer sees (/state.players, WebMCP, the first-day goal): the shared `spireSeesPlayer` rule. Players
 * outside Bramblewild are not this rule's concern (callers already keep the viewer's region only).
 */
export function visiblePlayers<P extends BossPlayer>(me: P, players: Iterable<P>, rows: BossRows): P[] {
  const meHex = hexOf(me.identity);
  const { mates } = myRun(rows, meHex);
  const runHexes = new Set(mates.map((m) => hexOf(m.identity)));
  const viewer: Tile = homeRegion(me) ? me : { x: -1, z: -1 };
  return [...players].filter((p) => {
    const hex = hexOf(p.identity);
    if (hex === meHex || !homeRegion(p)) return true;
    return spireSeesPlayer(viewer, p, runHexes.has(hex));
  });
}

/**
 * Tiles you move per tick (the server's `cargoMovementSteps`): 1 while you carry the giant berry, i.e. you are the
 * carrier of a hauling expedition, else 2.
 */
export function moveStepsOf(meHex: string, expeditions: Iterable<{ stage: string; carrier?: Hex | string | null }>): 1 | 2 {
  for (const e of expeditions) if (e.stage === 'hauling' && e.carrier && hexOf(e.carrier) === meHex) return cargoMovementSteps(true) as 1;
  return cargoMovementSteps(false) as 2;
}

/**
 * `state.clatterhorn` and `state.spire` (both null outside Bramblewild). `blocked` is the stable world blocked set
 * /danger gets and `maxSteps` your tiles per tick (`moveStepsOf`), so the telegraph's escapes match /danger.
 */
export function describeBosses(rows: BossRows, me: BossPlayer, tick: number, options: {
  players: Iterable<BossPlayer>; keysHeld: number; contribution: number | null; blocked: Set<number>; maxSteps?: 1 | 2;
}) {
  if (!homeRegion(me)) return { clatterhorn: null, spire: null };
  const cfg = bossConfigOr(rows.config);
  const meHex = hexOf(me.identity);
  const byHex = new Map([...options.players].map((p) => [hexOf(p.identity), p]));
  const { fight } = myRun(rows, meHex);
  return {
    clatterhorn: describeClatterhorn(rows.clatter ?? null, cfg, { x: me.x, z: me.z, identity: meHex }, tick, options.contribution,
      { blocked: options.blocked, maxSteps: options.maxSteps }),
    spire: describeSpire({
      cfg, runs: rows.runs, fight,
      members: rows.members.map((m) => ({ ...m, identity: hexOf(m.identity) })),
      me: { identity: meHex, x: me.x, z: me.z }, tick, keysHeld: options.keysHeld,
      name: (hex) => byHex.get(hex)?.name ?? null,
      player: (hex) => {
        const p = byHex.get(hex);
        return p && p.online !== false && homeRegion(p) ? { x: p.x, z: p.z, hp: p.hp } : null;
      },
    }),
  };
}

/**
 * GET /api/agent/v1/danger and WebMCP inspect_danger. `blocked` must be a stable Set (move tables are cached per
 * Set); `maxSteps` is your tiles per tick (`moveStepsOf`, default 2).
 */
export function dangerFeed(rows: BossRows, me: BossPlayer, tick: number, options: {
  players: Iterable<BossPlayer>; blocked: Set<number>; ageMs: number; tickMs: number; maxSteps?: 1 | 2;
}): DangerFeed {
  const meHex = hexOf(me.identity);
  const home = homeRegion(me);
  const byHex = new Map([...options.players].map((p) => [hexOf(p.identity), p]));
  const { mine, run, fight, mates } = myRun(rows, meHex);
  const spire = home && mine && run && fight ? {
    run, fight, mySlot: mine.slot, safety: null,
    members: mates.map((m): DangerMemberInput => {
      const hex = hexOf(m.identity);
      const p = hex === meHex ? me : byHex.get(hex);
      return { slot: m.slot, state: m.state, awaySinceTick: m.awaySinceTick, meals: m.meals, name: p?.name ?? '',
        player: p && p.online !== false && homeRegion(p) ? { identity: hex, x: p.x, z: p.z, hp: p.hp } : null };
    }),
  } : null;
  return buildDangerFeed({
    tick, tickMs: options.tickMs, ageMs: Math.max(0, Math.round(options.ageMs)), rulesVersion: SPIRE_RULES_VERSION,
    me: { identity: meHex, x: me.x, z: me.z, hp: me.hp, maxHp: me.maxHp, eatCooldownUntilTick: me.eatCooldownUntilTick ?? 0 },
    blocked: options.blocked, maxSteps: options.maxSteps, spire, clatter: home ? rows.clatter ?? null : null,
  });
}

export type DodgeProblem = { status: number; code: string; message: string };
export const DODGE_TOO_FAR = 'A dodge moves at most 2 tiles; use move for longer walks';
export const DODGE_CARRYING = 'Carrying the giant berry you move 1 tile per tick, so a dodge moves at most 1 tile';
export const DODGE_UNREACHABLE = 'That tile takes more than one tick to reach around what is in the way; pick a destination from GET /danger moves';
export const DODGE_NOT_HERE = "Dodge works only on the Sunken Spire floor or at Clatterhorn's glade; use move elsewhere";
export const DODGE_BAD_TILE = 'You cannot stand there; pick a destination from GET /danger moves';
export const RULES_MISMATCH = 'Your Spire run uses other rules than this gateway; retry after the update';
export const SPIRE_FLOOR_MOVE = 'The Sunken Spire floor is reached only through the Spire Gate';

/** A tile you may stand on at Clatterhorn: the glade minus its stones, or plain land around it (never the floor). */
const gladeStandable = (t: Tile, blocked: Set<number>) => Number.isInteger(t.x) && Number.isInteger(t.z) && t.x >= 0 && t.z >= 0
  && t.x < GRID_SIZE && t.z < GRID_SIZE && !blocked.has(t.z * GRID_SIZE + t.x) && !inSpireFloor(t) && (inClatterGlade(t) || isLandTile(t));

/**
 * The `dodge` action's gateway-side check (shared with WebMCP's dodge_to_tile): at most `maxSteps` tiles away
 * (2, or 1 while carrying the giant berry), only on the Spire floor (to a standable floor tile) or at Clatterhorn
 * (glade or the land around it), reachable in one tick (the /danger move tables), never into another rules
 * version. Returns the problem, or the receipt fields: `via` (the move's canonical middle tile) and `safe`
 * (whether that move is hit-free in tick + 1 under the server rule; null without a hazard source).
 */
export function dodgeCheck(rows: BossRows, me: BossPlayer, to: Tile, tick: number, blocked: Set<number>, maxSteps: 1 | 2 = 2):
  { problem: DodgeProblem } | { resolvesAtTick: number; via: [number, number]; to: [number, number]; safe: boolean | null } {
  if (chebyshev(me, to) > maxSteps) return { problem: { status: 422, code: 'dodge_too_far', message: maxSteps < 2 ? DODGE_CARRYING : DODGE_TOO_FAR } };
  const floor = onSpireFloor(me);
  const glade = !floor && homeRegion(me) && atClatterhorn(me);
  if (!floor && !glade) return { problem: { status: 422, code: 'dodge_unavailable', message: DODGE_NOT_HERE } };
  const ok = floor ? spireStandable(to) && !blocked.has(to.z * GRID_SIZE + to.x) : gladeStandable(to, blocked) && atClatterhorn(to);
  if (!ok) return { problem: { status: 422, code: 'dodge_target', message: DODGE_BAD_TILE } };
  const { run, fight } = myRun(rows, hexOf(me.identity));
  if (floor && run && run.stage === SpireStage.Active && run.rules !== SPIRE_RULES_VERSION) {
    return { problem: { status: 409, code: 'rules_mismatch', message: RULES_MISMATCH } };
  }
  // Only a move the server finishes this tick: past a stone or around the dais a 2-tile target can take 3-4 steps.
  const move = dangerMoveTo(floor ? 'spire' : 'clatterhorn', me, to, blocked, floor ? 2 : maxSteps);
  if (!move) return { problem: { status: 422, code: 'dodge_target', message: DODGE_UNREACHABLE } };
  const via = move.mid;
  const T = tick + 1;
  let safe: boolean | null = null;
  if (floor && fight && run?.stage === SpireStage.Active) safe = spireHitsMove(spireFightBullets(fight), T, me, via, to) === 0;
  else if (glade && rows.clatter && rows.clatter.state !== ClatterState.Closed) safe = clatterHitsMove(rows.clatter, T, me, via, to) === 0;
  return { resolvesAtTick: T, via: [via.x, via.z], to: [to.x, to.z], safe };
}

/** Exactly one of you and the destination is on the Spire floor (the `move` receipt's blockedBy "spire"). */
export function crossesSpireFloor(me: Tile & { region?: string }, to: Tile): boolean {
  return homeRegion(me) && inSpireFloor(me) !== inSpireFloor(to);
}

/**
 * Reducer refusals mapped to agent error codes (FINAL_SPEC 8.5), first match wins. "No fighting inside the
 * Sunken Spire" must read as no_pvp_zone, so that row comes before spire_inside. The full Spire (CORE_SCOPE:
 * no queue) has its own code, spire_full.
 */
const BOSS_ERRORS: readonly [string, readonly string[]][] = [
  ['party_not_ready', ['waiting for']],
  ['boss_closed', ['is sealed', 'glade is quiet']],
  ['client_outdated', ['out of date', 'older Spire']],
  ['spire_gate', ['Walk to the Sunken Spire gate']],
  ['spire_key', ['need a spire key']],
  ['spire_member', ['already in a Spire party', 'belong to a party that is fighting', 'waiting in a Spire party']],
  ['not_in_party', ['not in a Spire party']],
  ['not_leader', ['not leading a Spire party']],
  ['party_full', ['party is full']],
  ['party_gone', ['party is gone', 'already gone down', 'already queued']],
  ['no_open_party', ['No open Spire party']],
  ['spire_busy', ['gate is crowded']],
  ['spire_full', ['Spire is full right now']],
  ['no_pvp_zone', ['No fighting in Clatterhorn', 'No fighting at the Spire', 'No fighting inside']],
  ['spire_inside', ['inside the Sunken Spire', 'into or out of the Sunken Spire']],
  ['meal_limit', ['eaten your fill']],
  ['clatterhorn_burrowed', ['burrowed away']],
  ['on_expedition', ['on an expedition']],
  ['in_duel', ['during a duel']],
];

/** The agent error for a reducer refusal, or null to keep the generic action_rejected. */
export function bossError(error: unknown): { status: 422; code: string; message: string } | null {
  const message = String((error as Error)?.message ?? error).replace(/^SenderError:\s*/, '').slice(0, 300);
  for (const [code, parts] of BOSS_ERRORS) if (parts.some((part) => message.includes(part))) return { status: 422, code, message };
  return null;
}

const BOSS_NAMES: Record<number, string> = { [BossId.Clatterhorn]: 'clatterhorn', [BossId.Spire]: 'spire' };
const EVENT_NAMES: Record<number, string> = Object.fromEntries(Object.entries(BossEventKind).map(([k, v]) => [v, snake(k)]));
const NOTICE_NAMES: Record<number, string> = Object.fromEntries(Object.entries(BossNoticeKind).map(([k, v]) => [v, snake(k)]));
const HURT_SOURCES = ['', 'charge', 'spin', 'runner', 'bullet'];
function snake(name: string) { return name.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase()); }

export interface BossNoticeRow { tick: number; boss: number; kind: number; runId: bigint; amount: number; total: number; hp: number; half: number; quantity: number; itemId: string }
export interface BossEventRow { tick: number; boss: number; kind: number; runId: bigint; x: number; z: number; quantity: number; value: number; text: string }

/** One `state.notices` entry (`source: "boss"`) for your boss_notice row. */
export function describeBossNotice(n: BossNoticeRow) {
  const item = getItemDef(n.itemId)?.name ?? n.itemId;
  const text = (() => {
    switch (n.kind) {
      case BossNoticeKind.YouHit: return `You hit ${n.boss === BossId.Spire ? 'the Shardmother' : 'Clatterhorn'} for ${n.amount} (total ${n.total})`;
      case BossNoticeKind.Hurt: return `A ${HURT_SOURCES[n.quantity] || 'hazard'} hit you for ${n.amount} (${n.hp} HP left)`;
      case BossNoticeKind.Star: return `You caught a star: ${n.amount} damage (${n.total} stars)`;
      case BossNoticeKind.KnockedOut: return 'You were knocked out of the Sunken Spire; your bag is safe';
      case BossNoticeKind.Reward: return `Reward: ${n.quantity} ${item}`;
      case BossNoticeKind.Keepsake: return `Keepsake unlocked: ${getCosmetic(n.quantity)?.name ?? n.quantity}`;
      case BossNoticeKind.RunResult: return `Spire run ${SPIRE_OUTCOME_NAMES[n.quantity] ?? 'ended'} (${n.amount} stars)`;
      default: return '';
    }
  })();
  return { source: 'boss', tick: n.tick, boss: BOSS_NAMES[n.boss] ?? null, kind: NOTICE_NAMES[n.kind] ?? String(n.kind),
    runId: n.runId ? String(n.runId) : null, amount: n.amount, total: n.total, hp: n.hp, quantity: n.quantity,
    ...(n.itemId ? { itemId: n.itemId } : {}), text };
}

/** One `state.bossNews` entry (world boss moments). `text` is player names: untrusted. */
export function describeBossEvent(e: BossEventRow) {
  return { tick: e.tick, boss: BOSS_NAMES[e.boss] ?? null, kind: EVENT_NAMES[e.kind] ?? String(e.kind),
    runId: e.runId ? String(e.runId) : null, x: e.x, z: e.z, quantity: e.quantity, value: e.value, text: e.text };
}

/**
 * Your Clatterhorn damage this fight: the latest YouHit total, counted only while it is no older than the
 * beetle's last wake (`engagedTick`), the same rule WebMCP applies to the browser's notice ring.
 */
export class ClatterContribution {
  private last: { tick: number; total: number } | null = null;
  record(n: BossNoticeRow) {
    if (n.boss === BossId.Clatterhorn && n.kind === BossNoticeKind.YouHit) this.last = { tick: n.tick, total: n.total };
  }
  read(row: ClatterRowLike | null | undefined): number | null {
    return clatterContributionOf(this.last, row);
  }
}

/** A YouHit notice's total if it belongs to the current fight (at or after the last wake), else null. */
export function clatterContributionOf(hit: { tick: number; total: number } | null | undefined, row: ClatterRowLike | null | undefined): number | null {
  return row && hit && hit.tick >= row.engagedTick ? hit.total : null;
}
