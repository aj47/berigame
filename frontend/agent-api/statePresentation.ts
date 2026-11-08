// Shared by the HTTP API and browser WebMCP inspection.
export { describeDestination, describeGathering, describeObjective, describeAction, describeEconomy } from '../../shared/sim/agentState';
import {
  BossEventKind, BossId, BossNoticeKind, ClatterState, GRID_SIZE, HurtSource, LANTERN_BAIT, LANTERN_ENTRY_FEE, LANTERN_RULES_VERSION, SPIRE_OUTCOME_NAMES, SPIRE_RULES_VERSION,
  SpireStage, atClatterhorn, bossConfigOr, buildDangerFeed, cargoMovementSteps, chebyshev, clatterHitsMove, dangerMoveTo, describeClatterhorn,
  describeLantern, describeSpire, getCosmetic, getItemDef, inClatterGlade, inLanternFloor, inSealedFloor, inSpireFloor, isLandTile,
  lanternConfigOr, lanternHazardMask, lanternLocal, lanternStandable, spireFightBullets, spireHitsMove, spireSeesPlayer, spireStandable,
  type BossConfigLike, type ClatterRowLike, type DangerFeed, type DangerMemberInput, type LanternConfigLike, type LanternFightRowLike,
  type LanternMemberLike, type LanternRunLike, type Slot, type SpireFightLike, type SpireMemberLike, type SpireRunLike, type Tile,
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
export type LanternBossMember = LanternMemberLike & { identity: Hex };
export type LanternBossRun = LanternRunLike & { leader?: Hex | string | null };
export type LanternBossFight = LanternFightRowLike & { runId: bigint };
/**
 * The boss rows a reader holds: config, Clatterhorn, every Spire run and member, the Spire fight rows it subscribed,
 * and the same for Lanternmaw (optional: a reader without the lantern_* tables reads it as closed).
 */
export interface BossRows {
  config: BossConfigLike | null | undefined;
  clatter: ClatterRowLike | null | undefined;
  runs: readonly BossRun[];
  members: readonly BossMember[];
  fights: readonly BossFight[];
  lanternConfig?: LanternConfigLike | null;
  lanternRuns?: readonly LanternBossRun[];
  lanternMembers?: readonly LanternBossMember[];
  lanternFights?: readonly LanternBossFight[];
}

const hexOf = (v: Hex | string) => (typeof v === 'string' ? v : v.toHexString());
export const homeRegion = (p: { region?: string }) => (p.region || 'bramblewild') === 'bramblewild';
/** Standing on the Sunken Spire floor (Bramblewild only: other regions reuse the same x/z numbers). */
export const onSpireFloor = (p: Tile & { region?: string }) => homeRegion(p) && inSpireFloor(p);
/** Standing on Lanternmaw's floor, the Drowned Hollow (Bramblewild only). */
export const onLanternFloor = (p: Tile & { region?: string }) => homeRegion(p) && inLanternFloor(p);
/** Standing on either sealed floor: /state is slim there. */
export const onSealedFloor = (p: Tile & { region?: string }) => homeRegion(p) && inSealedFloor(p);

/** Your member row, its run, your run's fight row (null until subscribed) and every member of that run. */
export function myRun(rows: BossRows, meHex: string) {
  const members = rows.members;
  const mine = members.find((m) => hexOf(m.identity) === meHex) ?? null;
  if (!mine) return { mine: null, run: null, fight: null, mates: [] as BossMember[] };
  const run = rows.runs.find((r) => r.id === mine.runId) ?? null;
  const fight = rows.fights.find((f) => f.runId === mine.runId) ?? null;
  return { mine, run, fight, mates: members.filter((m) => m.runId === mine.runId) };
}

/** The same for Lanternmaw: your lantern_member row, its run, its fight row and every member of that run. */
export function myLanternRun(rows: BossRows, meHex: string) {
  const members = rows.lanternMembers ?? [];
  const mine = members.find((m) => hexOf(m.identity) === meHex) ?? null;
  if (!mine) return { mine: null, run: null, fight: null, mates: [] as LanternBossMember[] };
  const run = (rows.lanternRuns ?? []).find((r) => r.id === mine.runId) ?? null;
  const fight = (rows.lanternFights ?? []).find((f) => f.runId === mine.runId) ?? null;
  return { mine, run, fight, mates: members.filter((m) => m.runId === mine.runId) };
}

/**
 * Who a viewer sees (/state.players, WebMCP, the first-day goal): the shared `spireSeesPlayer` rule. Players
 * outside Bramblewild are not this rule's concern (callers already keep the viewer's region only).
 */
export function visiblePlayers<P extends BossPlayer>(me: P, players: Iterable<P>, rows: BossRows): P[] {
  const meHex = hexOf(me.identity);
  const { mates } = myRun(rows, meHex);
  // sameRun covers both sealed floors: your Spire run mates and your Lanternmaw run mates.
  const runHexes = new Set([...mates, ...myLanternRun(rows, meHex).mates].map((m) => hexOf(m.identity)));
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
 * `state.clatterhorn`, `state.spire` and `state.lantern` (all null outside Bramblewild). `blocked` is the stable world
 * blocked set /danger gets and `maxSteps` your tiles per tick (`moveStepsOf`), so the telegraph's escapes match
 * /danger. `entry` is your bag, coins and wielded weapon for Lanternmaw's entry checks (null: unknown).
 */
export function describeBosses(rows: BossRows, me: BossPlayer, tick: number, options: {
  players: Iterable<BossPlayer>; keysHeld: number; contribution: number | null; blocked: Set<number>; maxSteps?: 1 | 2;
  entry?: { slots: readonly Slot[]; coins: number | null; wielded: string } | null;
}) {
  if (!homeRegion(me)) return { clatterhorn: null, spire: null, lantern: null };
  const cfg = bossConfigOr(rows.config);
  const meHex = hexOf(me.identity);
  const byHex = new Map([...options.players].map((p) => [hexOf(p.identity), p]));
  const { fight } = myRun(rows, meHex);
  const name = (hex: string) => byHex.get(hex)?.name ?? null;
  const player = (hex: string) => {
    const p = byHex.get(hex);
    return p && p.online !== false && homeRegion(p) ? { x: p.x, z: p.z, hp: p.hp } : null;
  };
  return {
    clatterhorn: describeClatterhorn(rows.clatter ?? null, cfg, { x: me.x, z: me.z, identity: meHex }, tick, options.contribution,
      { blocked: options.blocked, maxSteps: options.maxSteps }),
    spire: describeSpire({
      cfg, runs: rows.runs, fight,
      members: rows.members.map((m) => ({ ...m, identity: hexOf(m.identity) })),
      me: { identity: meHex, x: me.x, z: me.z }, tick, keysHeld: options.keysHeld,
      name, player,
    }),
    lantern: describeLantern({
      cfg: lanternConfigOr(rows.lanternConfig), runs: rows.lanternRuns ?? [], fight: myLanternRun(rows, meHex).fight,
      members: (rows.lanternMembers ?? []).map((m) => ({ ...m, identity: hexOf(m.identity) })),
      me: { identity: meHex, x: me.x, z: me.z }, tick, entry: options.entry ?? null, name, player,
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
  const memberInput = (m: { identity: Hex; slot: number; state: number; awaySinceTick: number; meals: number }): DangerMemberInput => {
    const hex = hexOf(m.identity);
    const p = hex === meHex ? me : byHex.get(hex);
    return { slot: m.slot, state: m.state, awaySinceTick: m.awaySinceTick, meals: m.meals, name: p?.name ?? '',
      player: p && p.online !== false && homeRegion(p) ? { identity: hex, x: p.x, z: p.z, hp: p.hp } : null };
  };
  const spire = home && mine && run && fight ? { run, fight, mySlot: mine.slot, safety: null, members: mates.map(memberInput) } : null;
  const ln = myLanternRun(rows, meHex);
  const lantern = home && ln.mine && ln.run && ln.fight ? { run: ln.run, fight: ln.fight, mySlot: ln.mine.slot, members: ln.mates.map(memberInput) } : null;
  return buildDangerFeed({
    tick, tickMs: options.tickMs, ageMs: Math.max(0, Math.round(options.ageMs)), rulesVersion: SPIRE_RULES_VERSION,
    me: { identity: meHex, x: me.x, z: me.z, hp: me.hp, maxHp: me.maxHp, eatCooldownUntilTick: me.eatCooldownUntilTick ?? 0 },
    blocked: options.blocked, maxSteps: options.maxSteps, spire, clatter: home ? rows.clatter ?? null : null,
    lantern, lanternRulesVersion: LANTERN_RULES_VERSION,
  });
}

export type DodgeProblem = { status: number; code: string; message: string };
export const DODGE_TOO_FAR = 'A dodge moves at most 2 tiles; use move for longer walks';
export const DODGE_CARRYING = 'Carrying the giant berry you move 1 tile per tick, so a dodge moves at most 1 tile';
export const DODGE_UNREACHABLE = 'That tile takes more than one tick to reach around what is in the way; pick a destination from GET /danger moves';
export const DODGE_NOT_HERE = "Dodge works only on the Sunken Spire floor, in the Drowned Hollow or at Clatterhorn's glade; use move elsewhere";
export const DODGE_BAD_TILE = 'You cannot stand there; pick a destination from GET /danger moves';
export const RULES_MISMATCH = 'Your Spire run uses other rules than this gateway; retry after the update';
export const LANTERN_RULES_MISMATCH = 'Your Lanternmaw run uses other rules than this gateway; retry after the update';
export const SPIRE_FLOOR_MOVE = 'The Sunken Spire floor is reached only through the Spire Gate';
export const LANTERN_FLOOR_MOVE = 'The Drowned Hollow is reached only through the Fen Gate';

/** A tile you may stand on at Clatterhorn: the glade minus its stones, or plain land around it (never the floor). */
const gladeStandable = (t: Tile, blocked: Set<number>) => Number.isInteger(t.x) && Number.isInteger(t.z) && t.x >= 0 && t.z >= 0
  && t.x < GRID_SIZE && t.z < GRID_SIZE && !blocked.has(t.z * GRID_SIZE + t.x) && !inSealedFloor(t) && (inClatterGlade(t) || isLandTile(t));

/**
 * The `dodge` action's gateway-side check (shared with WebMCP's dodge_to_tile): at most `maxSteps` tiles away
 * (2, or 1 while carrying the giant berry), only on the Spire floor or Lanternmaw's floor (to a standable floor tile)
 * or at Clatterhorn (glade or the land around it), reachable in one tick (the /danger move tables), never into
 * another rules version. Returns the problem, or the receipt fields: `via` (the move's canonical middle tile) and `safe`
 * (whether that move is hit-free in tick + 1 under the server rule; null without a hazard source).
 */
export function dodgeCheck(rows: BossRows, me: BossPlayer, to: Tile, tick: number, blocked: Set<number>, maxSteps: 1 | 2 = 2):
  { problem: DodgeProblem } | { resolvesAtTick: number; via: [number, number]; to: [number, number]; safe: boolean | null } {
  if (chebyshev(me, to) > maxSteps) return { problem: { status: 422, code: 'dodge_too_far', message: maxSteps < 2 ? DODGE_CARRYING : DODGE_TOO_FAR } };
  const floor = onSpireFloor(me);
  const hollow = !floor && onLanternFloor(me);
  const glade = !floor && !hollow && homeRegion(me) && atClatterhorn(me);
  if (!floor && !hollow && !glade) return { problem: { status: 422, code: 'dodge_unavailable', message: DODGE_NOT_HERE } };
  const free = !blocked.has(to.z * GRID_SIZE + to.x);
  const ok = floor ? spireStandable(to) && free : hollow ? lanternStandable(to) && free : gladeStandable(to, blocked) && atClatterhorn(to);
  if (!ok) return { problem: { status: 422, code: 'dodge_target', message: DODGE_BAD_TILE } };
  const meHex = hexOf(me.identity);
  const { run, fight } = myRun(rows, meHex);
  if (floor && run && run.stage === SpireStage.Active && run.rules !== SPIRE_RULES_VERSION) {
    return { problem: { status: 409, code: 'rules_mismatch', message: RULES_MISMATCH } };
  }
  const ln = hollow ? myLanternRun(rows, meHex) : null;
  if (ln?.run && ln.run.stage === SpireStage.Active && ln.run.rules !== LANTERN_RULES_VERSION) {
    return { problem: { status: 409, code: 'rules_mismatch', message: LANTERN_RULES_MISMATCH } };
  }
  // Only a move the server finishes this tick: past a stone or around the dais a 2-tile target can take 3-4 steps.
  const move = dangerMoveTo(floor ? 'spire' : hollow ? 'lantern' : 'clatterhorn', me, to, blocked, floor || hollow ? 2 : maxSteps);
  if (!move) return { problem: { status: 422, code: 'dodge_target', message: DODGE_UNREACHABLE } };
  const via = move.mid;
  const T = tick + 1;
  let safe: boolean | null = null;
  if (floor && fight && run?.stage === SpireStage.Active) safe = spireHitsMove(spireFightBullets(fight), T, me, via, to) === 0;
  // Lanternmaw hits end tiles only (blows, pulses and the flood): the server rule for tick + 1.
  else if (ln?.fight && ln.run?.stage === SpireStage.Active) safe = T >= ln.run.startTick && T <= ln.run.endTick ? lanternHazardMask(ln.fight, T, ln.run.startTick)[lanternLocal(to)] === 0 : true;
  else if (glade && rows.clatter && rows.clatter.state !== ClatterState.Closed) safe = clatterHitsMove(rows.clatter, T, me, via, to) === 0;
  return { resolvesAtTick: T, via: [via.x, via.z], to: [to.x, to.z], safe };
}

/** Exactly one of you and the destination is on the Spire floor (the `move` receipt's blockedBy "spire"). */
export function crossesSpireFloor(me: Tile & { region?: string }, to: Tile): boolean {
  return homeRegion(me) && inSpireFloor(me) !== inSpireFloor(to);
}

/** Exactly one of you and the destination is on Lanternmaw's floor (the `move` receipt's blockedBy "lantern"). */
export function crossesLanternFloor(me: Tile & { region?: string }, to: Tile): boolean {
  return homeRegion(me) && inLanternFloor(me) !== inLanternFloor(to);
}

/**
 * Reducer refusals mapped to agent error codes (FINAL_SPEC 8.5), first match wins. "No fighting inside the
 * Sunken Spire" (or the Drowned Hollow) must read as no_pvp_zone, so that row comes before spire_inside and
 * lantern_inside. The full Spire (CORE_SCOPE: no queue) has its own code, spire_full; the full Hollow lantern_full.
 * A Lanternmaw member's entry problem while the leader starts reads party_not_ready ("waiting for <name>: ...").
 */
const BOSS_ERRORS: readonly [string, readonly string[]][] = [
  ['party_not_ready', ['waiting for']],
  ['boss_closed', ['is sealed', 'glade is quiet']],
  ['client_outdated', ['out of date', 'older Spire', 'older Drowned Hollow']],
  ['spire_gate', ['Walk to the Sunken Spire gate']],
  ['lantern_gate', ['Walk to the Fen Gate']],
  ['spire_key', ['need a spire key']],
  ['lantern_member', ['already in a Lanternmaw party', 'waiting in a Lanternmaw party', 'in a Lanternmaw party; leave it first']],
  ['spire_member', ['already in a Spire party', 'belong to a party that is fighting', 'waiting in a Spire party', 'in a Spire party; leave it first']],
  ['not_in_party', ['not in a Spire party', 'not in a Lanternmaw party']],
  ['not_leader', ['not leading a Spire party', 'not leading a Lanternmaw party']],
  ['party_full', ['party is full']],
  ['party_gone', ['party is gone', 'already gone down', 'already queued']],
  ['no_open_party', ['No open Spire party', 'No open Lanternmaw party']],
  ['lantern_busy', ['Fen Gate is crowded']],
  ['spire_busy', ['gate is crowded']],
  ['spire_full', ['Spire is full right now']],
  ['lantern_full', ['Drowned Hollow is full right now']],
  ['no_pvp_zone', ['No fighting in Clatterhorn', 'No fighting at the Spire', 'No fighting inside']],
  ['spire_inside', ['inside the Sunken Spire', 'into or out of the Sunken Spire']],
  ['lantern_inside', ['inside the Drowned Hollow', 'into or out of the Drowned Hollow']],
  ['meal_limit', ['eaten your fill']],
  ['clatterhorn_burrowed', ['burrowed away']],
  ['on_expedition', ['on an expedition']],
  ['in_duel', ['during a duel']],
];
/**
 * Checked first for the `lantern` action: your own entry problems (a member's read party_not_ready), and the
 * refusal worded the same for both sealed floors, read as Lanternmaw's.
 */
const LANTERN_ACTION_ERRORS: readonly [string, readonly string[]][] = [
  ['party_not_ready', ['waiting for']],
  ['lantern_weapon', ['Bring a weapon to the Drowned Hollow']],
  ['lantern_bait', [`need a ${LANTERN_BAIT.name}`]],
  ['lantern_fee', [`need ${LANTERN_ENTRY_FEE} coins`]],
  ['lantern_member', ['belong to a party that is fighting']],
];

/**
 * The agent error for a reducer refusal, or null to keep the generic action_rejected. `action` is the agent action
 * that was refused (the `lantern` action reads the shared "still belong to a party" refusal as lantern_member).
 */
export function bossError(error: unknown, action?: string): { status: 422; code: string; message: string } | null {
  const message = String((error as Error)?.message ?? error).replace(/^SenderError:\s*/, '').slice(0, 300);
  const tables = action === 'lantern' ? [LANTERN_ACTION_ERRORS, BOSS_ERRORS] : [BOSS_ERRORS];
  for (const table of tables) for (const [code, parts] of table) if (parts.some((part) => message.includes(part))) return { status: 422, code, message };
  return null;
}

const BOSS_NAMES: Record<number, string> = { [BossId.Clatterhorn]: 'clatterhorn', [BossId.Spire]: 'spire', [BossId.Lanternmaw]: 'lanternmaw' };
const EVENT_NAMES: Record<number, string> = Object.fromEntries(Object.entries(BossEventKind).map(([k, v]) => [v, snake(k)]));
const NOTICE_NAMES: Record<number, string> = Object.fromEntries(Object.entries(BossNoticeKind).map(([k, v]) => [v, snake(k)]));
/** Index = HurtSource. */
const HURT_SOURCES = ['', 'charge', 'spin', 'runner', 'bullet', 'blow', 'lure pulse', 'flood', 'bite'];
const BOSS_TITLES: Record<number, string> = { [BossId.Clatterhorn]: 'Clatterhorn', [BossId.Spire]: 'the Shardmother', [BossId.Lanternmaw]: 'Lanternmaw' };
function snake(name: string) { return name.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c.toLowerCase()); }

export interface BossNoticeRow { tick: number; boss: number; kind: number; runId: bigint; amount: number; total: number; hp: number; half: number; quantity: number; itemId: string }
export interface BossEventRow { tick: number; boss: number; kind: number; runId: bigint; x: number; z: number; quantity: number; value: number; text: string }

/** One `state.notices` entry (`source: "boss"`) for your boss_notice row. */
export function describeBossNotice(n: BossNoticeRow) {
  const item = getItemDef(n.itemId)?.name ?? n.itemId;
  const text = (() => {
    switch (n.kind) {
      case BossNoticeKind.YouHit: return `You hit ${BOSS_TITLES[n.boss] ?? 'Clatterhorn'} for ${n.amount} (total ${n.total})`;
      case BossNoticeKind.Hurt:
        if (n.quantity === HurtSource.Drown) return `The flood cost you ${n.amount} HP: get on a boardwalk plank (${n.hp} HP left)`;
        if (n.quantity === HurtSource.Bite) return `Lanternmaw bit you for ${n.amount} as you capped the spring (${n.hp} HP left)`;
        return `A ${HURT_SOURCES[n.quantity] || 'hazard'} hit you for ${n.amount} (${n.hp} HP left)`;
      case BossNoticeKind.Star: return `You caught a star: ${n.amount} damage (${n.total} stars)`;
      case BossNoticeKind.KnockedOut: return n.boss === BossId.Lanternmaw
        ? 'You were knocked out of the Drowned Hollow; your bag is safe' : 'You were knocked out of the Sunken Spire; your bag is safe';
      case BossNoticeKind.Reward: return `Reward: ${n.quantity} ${item}`;
      case BossNoticeKind.Wielded: return `You drew your ${item} (${n.amount} damage): the fight swings only your wielded weapon`;
      case BossNoticeKind.Keepsake: return `Keepsake unlocked: ${getCosmetic(n.quantity)?.name ?? n.quantity}`;
      case BossNoticeKind.RunResult: return n.boss === BossId.Lanternmaw
        ? `Lanternmaw run ${SPIRE_OUTCOME_NAMES[n.quantity] ?? 'ended'} (${n.amount} damage)`
        : `Spire run ${SPIRE_OUTCOME_NAMES[n.quantity] ?? 'ended'} (${n.amount} stars)`;
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
