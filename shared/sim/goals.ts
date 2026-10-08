/**
 * The "First Day" goal chip, as one pure function shared by the browser chip
 * and the agent gateway's `state.goal`.
 *
 * Steps come from live state plus a remembered done set, so eating the berry
 * never un-completes a step. Without a stick the hedge cannot be crossed, so a
 * player who loses it (a death drop) before reaching the Coast searches again,
 * and after First Day one holding no stick sees "find a stick" and "reach the
 * Coast" again: they respawned in the Grove and need a new key.
 */
import { areaOf, BOULDERS_ENTRY, coastPastCrossing, HEDGE_CROSSINGS, holdsItem, isNewcomer } from './areas';
import { bossConfigOr, type BossConfigLike } from './bossConfig';
import { CLATTER_HOME, inClatterGlade, SPIRE_EXIT, SPIRE_GATE, SPIRE_GATE_RANGE } from './bossZones';
import { ClatterState } from './clatterhorn';
import { GIANT_ID, GiantState } from './giant';
import { HARVEST_TICKS, HOTBAR_SIZE, MELEE_RANGE, MOVEMENT_STEPS_PER_TICK, TICK_MS, TREE_COOLDOWN_TICKS } from './constants';
import { chebyshev } from './grid';
import { DRIFTWOOD_ITEM_ID, FLINT_ITEM_ID, getItemDef, GLEAMSHELL_ITEM_ID, OBSIDIAN_ITEM_ID, SPIRE_KEY_ITEM_ID, STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from './items';
import { countItem } from './inventory';
import { canCraft, getRecipe, harvestTicksFor, isBerryNode, NodeKind, regrowTicksFor } from './nodes';
import { Pending, PlayerState, type Slot, type Tile } from './types';
import { Cosmetic, harvestXp, hasCosmetic, xpForLevel } from './skills';

export type GoalStepId = 'pick-berry' | 'eat-berry' | 'find-stick' | 'wield-stick' | 'reach-coast'
  // M2, after First Day:
  | 'gather-coast' | 'make-club' | 'wield-club'
  // M3 / F3, after the club:
  | 'reach-boulders' | 'face-giant' | 'gather-obsidian'
  // F4 / F5, the road to the Sunken Spire:
  | 'clatter-sealed' | 'reach-glade' | 'clatter-resting' | 'face-clatterhorn'
  | 'make-key' | 'spire-sealed' | 'reach-spire' | 'open-spire' | 'make-circlet'
  // Any time after a defeat:
  | 'recover-bag';
/** Done-set marker recorded once all First Day steps are complete. */
export const FIRST_DAY_DONE = 'first-day';
export type GoalDoneId = GoalStepId | typeof FIRST_DAY_DONE;

export const GOAL_STEPS: readonly GoalStepId[] = ['pick-berry', 'eat-berry', 'find-stick', 'wield-stick', 'reach-coast'];

/** One claim cycle of a tree: the harvest plus its regrowth. */
export const CLAIM_CYCLE_TICKS = HARVEST_TICKS + TREE_COOLDOWN_TICKS;

export type GoalAction =
  | { kind: 'harvest'; treeId: number }
  | { kind: 'eat'; slot: number }
  | { kind: 'wield'; slot: number }
  | { kind: 'move'; x: number; z: number }
  | { kind: 'craft'; recipe: string }
  | { kind: 'giant'; giantId: number }
  | { kind: 'clatterhorn' }
  /** Open the Sunken Spire's party panel (you stand at the gate). */
  | { kind: 'spire' }
  | { kind: 'pickup'; itemId: number | bigint };

export interface Goal {
  id: GoalStepId;
  text: string;
  hint: string;
  /** What tapping the chip does; null while busy (walking, waiting, harvesting). */
  action: GoalAction | null;
  /** Set while parked next to a claimed or regrowing tree. */
  waiting?: { treeId: number; ripeInTicks: number };
}

export interface GoalPlayer extends Tile {
  hp: number;
  maxHp: number;
  state: number;
  weapon: string;
  pending: number;
  pendingId: number | bigint;
  harvestTreeId: number;
  harvestEndTick: number;
  respawnTick: number;
  lastInputTick: number;
  online?: boolean;
}

export interface GoalTree extends Tile {
  id: number;
  itemId: string;
  /** shared/sim NodeKind; absent = berry tree. */
  kind?: number;
  cooldownUntilTick: number;
  /** Anything truthy while someone is harvesting it. */
  harvester?: unknown;
}

export interface GoalInput {
  me: GoalPlayer;
  slots: readonly Slot[];
  trees: readonly GoalTree[];
  /** Everyone else (used to estimate queues at trees). */
  others: readonly GoalPlayer[];
  tick: number;
  /** Whether this player may fight; without it the wield step is skipped. */
  canFight: boolean;
  /** Optional authoritative progress for the guaranteed first Stick. */
  foragingXp?: number;
  done: readonly string[];
  /** The Giant's row, if known (its state decides between fighting it and chipping obsidian). */
  giant?: { id: number; state: number } | null;
  /** Events seen by the client: a finished harvest or an eat by this player. */
  seen?: { harvested?: boolean; ate?: boolean };
  /**
   * The bosses' owner switches and Clatterhorn's row. Absent means unknown and
   * reads as closed, like a missing `boss_config` row.
   */
  bosses?: GoalBosses | null;
  /** `player_cosmetic.unlocked`: keepsakes mark a cleared Spire. */
  cosmetics?: number;
  /** Crafting level, for the level-gated Shard Circlet. */
  craftingLevel?: number;
  /** Items you dropped on defeat, nearest first (any one tile of the pile). */
  bag?: GoalBag | null;
}

export interface GoalBosses {
  clatterhornOpen: boolean;
  spireOpen: boolean;
  clatter?: { state: number; stateUntilTick: number } | null;
}

export interface GoalBag extends Tile { id: number | bigint }

export interface GoalResult {
  goal: Goal | null;
  /** The updated done set, to remember. */
  done: GoalDoneId[];
}

function edibleSlot(slots: readonly Slot[]): number {
  let best = -1;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (!s || (getItemDef(s.itemId)?.healthRestore ?? 0) <= 0) continue;
    if (best === -1 || (i < HOTBAR_SIZE && best >= HOTBAR_SIZE)) best = i;
    if (i < HOTBAR_SIZE) break;
  }
  return best;
}

function sameNum(a: number | bigint, b: number): boolean {
  return Number(a) === b;
}

/** Tick at which `tree` is next free to claim, ignoring waiters. */
export function treeReadyTick(tree: GoalTree, players: readonly GoalPlayer[], tick: number): number {
  if (tree.harvester) {
    const h = players.find((p) => p.harvestTreeId === tree.id);
    const end = h ? Math.max(h.harvestEndTick, tick) : tick + harvestTicksFor(tree.kind);
    return end + regrowTicksFor(tree.kind);
  }
  return Math.max(tree.cooldownUntilTick, tick);
}

/**
 * Estimated tick at which `me` could claim `tree`: max(ripening, arrival) + one cycle per rival waiter. Claims are a draw
 * among the waiters in the top tier (newcomers, then everyone), so with n rivals the expected wait is about n cycles
 * (energy weights the odds, but rivals' meters are private).
 */
export function claimEstimate(me: GoalPlayer, tree: GoalTree, others: readonly GoalPlayer[], tick: number): number {
  const ready = treeReadyTick(tree, [me, ...others], tick);
  const walk = Math.ceil(Math.max(0, chebyshev(me, tree) - MELEE_RANGE) / MOVEMENT_STEPS_PER_TICK);
  const meNew = isNewcomer(me, tick);
  let ahead = 0;
  for (const o of others) {
    if (o.online === false || o.state !== PlayerState.Alive) continue;
    if (o.pending !== Pending.Harvest || !sameNum(o.pendingId, tree.id)) continue;
    if (isNewcomer(o, tick) || !meNew) ahead++;
  }
  return Math.max(ready, tick + walk) + ahead * (harvestTicksFor(tree.kind) + regrowTicksFor(tree.kind));
}

/**
 * The node with the soonest claim for `me`, then nearest, then lowest id.
 * Only berry trees unless `kind` names another node kind.
 */
export function bestTree(me: GoalPlayer, trees: readonly GoalTree[], others: readonly GoalPlayer[], tick: number, kind: number = NodeKind.Berry): { tree: GoalTree; claimAt: number } | null {
  let best: { tree: GoalTree; claimAt: number } | null = null;
  for (const tree of trees) {
    if ((tree.kind ?? NodeKind.Berry) !== kind) continue;
    const claimAt = claimEstimate(me, tree, others, tick);
    if (!best
      || claimAt < best.claimAt
      || (claimAt === best.claimAt && (chebyshev(me, tree) < chebyshev(me, best.tree)
        || (chebyshev(me, tree) === chebyshev(me, best.tree) && tree.id < best.tree.id)))) {
      best = { tree, claimAt };
    }
  }
  return best;
}

function seconds(ticks: number): number {
  return Math.max(0, Math.ceil((ticks * TICK_MS) / 1000));
}

function treeName(tree: GoalTree): string {
  if (tree.kind === NodeKind.Driftwood) return 'driftwood pile';
  if (tree.kind === NodeKind.TideRock) return 'tide rock';
  if (tree.kind === NodeKind.Obsidian) return 'obsidian outcrop';
  return (getItemDef(tree.itemId)?.name ?? 'berry').toLowerCase() + ' tree';
}

/** Gathering half of steps 1 and 3: walk, wait, harvest or pick the best tree. */
function gatherGoal(id: GoalStepId, text: string, idleHint: string, input: GoalInput, kind: number = NodeKind.Berry): Goal {
  const { me, others, tick } = input;
  // First Day berry steps stay in the Grove; Coast thickets need a stick to reach.
  const trees = input.trees.filter((t) => (t.kind ?? NodeKind.Berry) === kind && (kind !== NodeKind.Berry || areaOf(t) === 'grove'));
  if (me.harvestTreeId !== 0) {
    const tree = trees.find((t) => t.id === me.harvestTreeId);
    return { id, text, hint: `${tree && !isBerryNode(tree) ? 'Gathering from' : 'Picking'} the ${tree ? treeName(tree) : 'tree'}…`, action: null };
  }
  const best = bestTree(me, trees, others, tick, kind);
  const current = me.pending === Pending.Harvest ? trees.find((t) => sameNum(me.pendingId, t.id)) : undefined;
  if (current) {
    const currentAt = claimEstimate(me, current, others, tick);
    const retarget = best && best.tree.id !== current.id && best.claimAt + CLAIM_CYCLE_TICKS <= currentAt;
    if (!retarget) {
      if (chebyshev(me, current) <= MELEE_RANGE) {
        const ripeIn = treeReadyTick(current, [me, ...others], tick) - tick;
        return {
          id, text,
          hint: ripeIn > 0 ? `Waiting: ripe in ${seconds(ripeIn)} s` : 'Waiting for the draw…',
          action: null,
          waiting: { treeId: current.id, ripeInTicks: Math.max(0, ripeIn) },
        };
      }
      return { id, text, hint: `Walking to the ${treeName(current)}…`, action: null };
    }
  }
  if (!best) return { id, text, hint: idleHint, action: null };
  const wait = best.claimAt - tick;
  return {
    id, text,
    hint: wait > Math.ceil(Math.max(0, chebyshev(me, best.tree) - MELEE_RANGE) / MOVEMENT_STEPS_PER_TICK) + 1
      ? `Tap: the ${treeName(best.tree)} ${isBerryNode(best.tree) ? 'ripens' : 'is ready'} in about ${seconds(wait)} s`
      : `Tap to ${isBerryNode(best.tree) ? 'pick' : 'gather from'} the ${treeName(best.tree)}`,
    action: { kind: 'harvest', treeId: best.tree.id },
  };
}

function nearestCoastTile(me: Tile): Tile {
  let best = HEDGE_CROSSINGS[0];
  for (const c of HEDGE_CROSSINGS) if (chebyshev(me, c) < chebyshev(me, best)) best = c;
  return coastPastCrossing(best);
}

export function firstDayGoal(input: GoalInput): GoalResult {
  const { me, slots, canFight } = input;
  const done = new Set<string>(input.done);
  const hasStick = holdsItem(slots, me.weapon, STICK_ITEM_ID);
  const food = edibleSlot(slots);

  if (input.seen?.harvested || food !== -1) done.add('pick-berry');
  if (input.seen?.ate || me.hp >= me.maxHp) done.add('eat-berry');
  if (hasStick) done.add('find-stick');
  if (!canFight || me.weapon === STICK_ITEM_ID || me.weapon === STONE_CLUB_ITEM_ID) done.add('wield-stick');
  if (areaOf(me) === 'coast') done.add('reach-coast');
  if (GOAL_STEPS.every((s) => done.has(s))) done.add(FIRST_DAY_DONE);
  // Before reaching the Coast, losing the stick (a death drop) makes "wield" and
  // "push through" impossible (the hedge needs it): search for one again.
  if (!hasStick && !done.has('reach-coast')) done.delete('find-stick');
  // After First Day, losing the key (a death drop) brings back "find" and "push through".
  if (done.has(FIRST_DAY_DONE) && !hasStick) {
    done.delete('find-stick');
    if (areaOf(me) !== 'coast') done.delete('reach-coast');
  }

  const out = GOAL_STEPS.concat().filter((s) => done.has(s)) as GoalDoneId[];
  if (done.has(FIRST_DAY_DONE)) out.push(FIRST_DAY_DONE);
  const result = (goal: Goal | null): GoalResult => ({ goal, done: out });

  if (me.state !== PlayerState.Alive) return result(null);
  // After a defeat, walking back for the bag beats starting the road again.
  const bagged = bagGoal(input, hasStick);
  if (bagged) return result(bagged);
  const step = GOAL_STEPS.find((s) => !done.has(s));
  switch (step) {
    case 'pick-berry':
      return result(gatherGoal(step, 'Pick a berry', 'No tree is free right now', input));
    case 'eat-berry': {
      if (food === -1) return result(gatherGoal(step, 'Pick another berry to eat', 'Your first berry was used or shared. Any fresh berry works.', input));
      const name = food !== -1 ? getItemDef(slots[food]!.itemId)?.name ?? 'berry' : 'berry';
      return result({
        id: step,
        text: `Eat it: tap the ${name} in your quick bar`,
        hint: food !== -1 && food < HOTBAR_SIZE ? `Or press ${food + 1}` : 'Tap to eat',
        action: food !== -1 ? { kind: 'eat', slot: food } : null,
      });
    }
    case 'find-stick': {
      const xp = input.foragingXp;
      const first = xp !== undefined && xp < xpForLevel(2);
      const progress = first ? ` · ${Math.max(0, Math.floor(xp / harvestXp(NodeKind.Berry)))}/${Math.ceil(xpForLevel(2) / harvestXp(NodeKind.Berry))} harvests` : '';
      return result(gatherGoal(step, `Gather for a sturdy stick${progress}`, 'First stick at Foraging level 2 (four harvests); then a 25% chance of spares', input));
    }
    case 'wield-stick': {
      const slot = slots.findIndex((s, i) => i < HOTBAR_SIZE && s?.itemId === STICK_ITEM_ID);
      return result({
        id: step,
        text: slot !== -1 ? 'Wield your stick: tap it' : 'Add your stick to a quick slot',
        hint: slot !== -1 ? `Or press ${slot + 1}. Hits twice as hard` : 'Open your bag, then drag it to slots 1–3',
        action: slot !== -1 ? { kind: 'wield', slot } : null,
      });
    }
    case 'reach-coast': {
      const to = nearestCoastTile(me);
      return result({
        id: step,
        text: 'Push through the brambles to the Coast',
        hint: 'Tap to walk through the hedge at the nearest path',
        action: { kind: 'move', x: to.x, z: to.z },
      });
    }
    default:
      return result(coastGoal(input, hasStick));
  }
}

const CLUB_RECIPE = getRecipe(STONE_CLUB_ITEM_ID)!;
const KEY_RECIPE = getRecipe(SPIRE_KEY_ITEM_ID)!;
const CIRCLET_RECIPE = getRecipe('shard_circlet')!;
/** Obsidian in one Spire Key. */
export const KEY_OBSIDIAN = KEY_RECIPE.inputs.find((i) => i.itemId === OBSIDIAN_ITEM_ID)!.quantity;
/** Where the chip walks a gleamshell hunter: just inside the glade's north edge, clear of the standing stones. */
export const GLADE_ENTRY: Tile = { x: 84, z: 101 };

/**
 * After First Day (M2): "Gather driftwood and 2 flint on the Coast" (n/3),
 * then "Make a stone club", then wield it. M3 continues with the boulders.
 */
function coastGoal(input: GoalInput, hasStick: boolean): Goal | null {
  const { me, slots, canFight } = input;
  if (holdsItem(slots, me.weapon, STONE_CLUB_ITEM_ID)) {
    if (!canFight || me.weapon === STONE_CLUB_ITEM_ID) return spireRoadGoal(input);
    const slot = slots.findIndex((s, i) => i < HOTBAR_SIZE && s?.itemId === STONE_CLUB_ITEM_ID);
    return {
      id: 'wield-club',
      text: slot !== -1 ? 'Wield your stone club: tap it' : 'Add your stone club to a quick slot',
      hint: slot !== -1 ? `Or press ${slot + 1}. Hits for 8` : 'Open your bag, then drag it to slots 1–3',
      action: slot !== -1 ? { kind: 'wield', slot } : null,
    };
  }
  if (canCraft(slots, CLUB_RECIPE)) {
    return { id: 'make-club', text: 'Make a stone club', hint: 'Tap to make it: 1 driftwood + 2 flint', action: { kind: 'craft', recipe: CLUB_RECIPE.id } };
  }
  if (!hasStick) return null;
  const wood = Math.min(1, countItem(slots, DRIFTWOOD_ITEM_ID));
  const flint = Math.min(2, countItem(slots, FLINT_ITEM_ID));
  const text = `Gather driftwood and 2 flint on the Coast (${wood + flint}/3)`;
  const kind = wood < 1 ? NodeKind.Driftwood : NodeKind.TideRock;
  return gatherGoal('gather-coast', text, 'Nothing to gather yet', input, kind);
}

/**
 * The road to the Sunken Spire, for a club holder: 3 obsidian in the Boulders,
 * 1 gleamshell from Clatterhorn, make a Spire Key, then descend. A cleared
 * Spire starts the road again (another key, more prism shards), and once you
 * hold the shards the Shard Circlet is offered.
 */
function spireRoadGoal(input: GoalInput): Goal | null {
  const { slots } = input;
  if (countItem(slots, SPIRE_KEY_ITEM_ID) > 0) return spireGoal(input);
  const circlet = circletGoal(input);
  if (circlet) return circlet;
  const obsidian = countItem(slots, OBSIDIAN_ITEM_ID);
  const gleamshell = countItem(slots, GLEAMSHELL_ITEM_ID);
  if (obsidian >= KEY_OBSIDIAN && gleamshell >= 1) {
    return { id: 'make-key', text: 'Make a Spire Key', hint: `Tap to make it: ${KEY_OBSIDIAN} obsidian + 1 gleamshell`, action: { kind: 'craft', recipe: KEY_RECIPE.id } };
  }
  if (obsidian < KEY_OBSIDIAN) return obsidianGoal(input, obsidian, gleamshell);
  return clatterGoal(input);
}

function cleared(input: GoalInput): boolean {
  return hasCosmetic(input.cosmetics ?? 0, Cosmetic.PrismCrown);
}

function circletGoal(input: GoalInput): Goal | null {
  if (hasCosmetic(input.cosmetics ?? 0, Cosmetic.ShardCirclet) || !canCraft(input.slots, CIRCLET_RECIPE)) return null;
  if ((input.craftingLevel ?? 1) < CIRCLET_RECIPE.level) return null;
  return { id: 'make-circlet', text: 'Make the Shard Circlet', hint: 'Tap to make it: 5 prism shards + 2 obsidian', action: { kind: 'craft', recipe: CIRCLET_RECIPE.id } };
}

/** M3 / F3: take the club to the Boulders, face the Giant while it is up, otherwise chip obsidian (n/3). */
function obsidianGoal(input: GoalInput, obsidian: number, gleamshell: number): Goal {
  const { me } = input;
  const progress = `${obsidian}/${KEY_OBSIDIAN}`;
  const why = gleamshell > 0 ? 'Spire Key' : cleared(input) ? 'another Spire Key' : 'a Spire Key';
  if (areaOf(me) !== 'boulders') {
    return {
      id: 'reach-boulders',
      text: obsidian > 0 ? `Gather obsidian in the Boulders (${progress})` : 'Take your club to the Boulders',
      hint: 'Tap to climb over the boulders past the Coast\'s south-east corner',
      action: { kind: 'move', x: BOULDERS_ENTRY.x, z: BOULDERS_ENTRY.z },
    };
  }
  const giant = input.giant;
  if (!giant || giant.state === GiantState.Defeated || giant.state === GiantState.Asleep) {
    const rest = !giant ? '' : giant.state === GiantState.Defeated ? 'The Giant rests: ' : 'The Giant sleeps: ';
    return gatherGoal('gather-obsidian', `${rest}chip obsidian for ${why} (${progress})`, 'No outcrop is ready yet', input, NodeKind.Obsidian);
  }
  if (me.pending === Pending.Giant) {
    return { id: 'face-giant', text: 'Face the Giant', hint: 'Step out of the red mark before it lands', action: null };
  }
  return {
    id: 'face-giant',
    text: `Face the Giant (everyone who helps gets obsidian) · ${progress}`,
    hint: 'Tap to fight. Step out of the red mark before it lands',
    action: { kind: 'giant', giantId: giant.id ?? GIANT_ID },
  };
}

function clock(ticks: number): string {
  const s = seconds(ticks);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** F4: gleamshell from Clatterhorn, in its glade in the far south-east wilds. */
function clatterGoal(input: GoalInput): Goal {
  const { me, tick } = input;
  const bosses = input.bosses;
  const walk: GoalAction = { kind: 'move', x: GLADE_ENTRY.x, z: GLADE_ENTRY.z };
  if (!bosses?.clatterhornOpen) {
    return { id: 'clatter-sealed', text: 'Clatterhorn still sleeps under its glade', hint: 'Gleamshell comes from Clatterhorn once the glade opens. Bank your obsidian in the vault meanwhile', action: null };
  }
  const here = inClatterGlade(me);
  const row = bosses.clatter;
  if (row && row.state === ClatterState.Burrowed) {
    return { id: 'clatter-resting', text: `Clatterhorn has burrowed: back in ${clock(row.stateUntilTick - tick)}`, hint: here ? 'Wait in the glade; it surfaces at the centre' : 'Tap to walk to its glade in the far south-east wilds', action: here ? null : walk };
  }
  if (!here) {
    return { id: 'reach-glade', text: 'Hunt Clatterhorn for gleamshell', hint: 'Tap to walk to its glade in the far south-east wilds. A defeat drops your bag: bank what you can spare first', action: walk };
  }
  if (me.pending === Pending.Clatterhorn) {
    return { id: 'face-clatterhorn', text: 'Fight Clatterhorn', hint: 'Leave its charge lane; a charge into a standing stone flips it for double damage', action: null };
  }
  return { id: 'face-clatterhorn', text: 'Fight Clatterhorn (everyone who helps gets 2 gleamshell)', hint: 'Tap to fight. Leave the lane it marks before it charges', action: { kind: 'clatterhorn' } };
}

/** F5: take the key to the Spire Gate and open (or join) a party. */
function spireGoal(input: GoalInput): Goal {
  const { me } = input;
  if (!input.bosses?.spireOpen) {
    return { id: 'spire-sealed', text: 'The Sunken Spire is still sealed', hint: 'Keep your key safe in your vault; the gate opens soon', action: null };
  }
  if (chebyshev(me, SPIRE_GATE) > SPIRE_GATE_RANGE) {
    return { id: 'reach-spire', text: 'Take your Spire Key to the Sunken Spire Gate', hint: 'Tap to walk to the obsidian arch on the Boulders\' east cliff', action: { kind: 'move', x: SPIRE_EXIT.x, z: SPIRE_EXIT.z } };
  }
  return { id: 'open-spire', text: cleared(input) ? 'Descend the Sunken Spire again' : 'Descend the Sunken Spire', hint: 'Tap to open the party panel. Parties of 1–4; each member spends a key', action: { kind: 'spire' } };
}

/** The dropped bag, when you can walk to it with the keys you hold. */
function bagGoal(input: GoalInput, hasStick: boolean): Goal | null {
  const { me, slots, bag } = input;
  if (!bag) return null;
  const from = areaOf(me), to = areaOf(bag);
  const club = holdsItem(slots, me.weapon, STONE_CLUB_ITEM_ID);
  const reachable = to === 'grove' || to === 'hedge' || to === 'spire' ? true
    : to === 'boulders' || to === 'boulder-line' ? (club || from === 'boulders') && (hasStick || from !== 'grove')
    : hasStick || from !== 'grove';
  if (!reachable || to === 'spire' || to === 'sea') return null;
  if (me.pending === Pending.Pickup) return { id: 'recover-bag', text: 'Recover your dropped bag', hint: 'Walking back to it…', action: null };
  return { id: 'recover-bag', text: 'Recover your dropped bag', hint: 'Tap to walk back and pick it up before it crumbles. It is marked on your map', action: { kind: 'pickup', itemId: bag.id } };
}

/**
 * Where a goal leads, for the map's marker and the agent API: the tile it walks
 * to or the thing it acts on. Null for steps done where you stand (eat, wield, make).
 */
export function goalTarget(goal: Goal, world: { trees?: readonly (Tile & { id: number })[]; giant?: Tile | null; clatter?: Tile | null; bag?: Tile | null } = {}): Tile | null {
  const a = goal.action;
  const treeId = a?.kind === 'harvest' ? a.treeId : goal.waiting?.treeId;
  if (treeId !== undefined) {
    const tree = world.trees?.find((t) => t.id === treeId);
    return tree ? { x: tree.x, z: tree.z } : null;
  }
  if (a?.kind === 'move') return { x: a.x, z: a.z };
  if (a?.kind === 'pickup') return world.bag ? { x: world.bag.x, z: world.bag.z } : null;
  switch (goal.id) {
    case 'face-giant': return world.giant ? { x: world.giant.x, z: world.giant.z } : null;
    case 'face-clatterhorn': return world.clatter ? { x: world.clatter.x, z: world.clatter.z } : { ...CLATTER_HOME };
    case 'clatter-sealed': case 'clatter-resting': return { ...CLATTER_HOME };
    case 'open-spire': case 'spire-sealed': return { ...SPIRE_GATE };
    default: return null;
  }
}

/** The goal input's boss facts from the `boss_config` and `clatterhorn` rows (a missing config row reads as closed). */
export function goalBosses(config: BossConfigLike | null | undefined, clatter: { state: number; stateUntilTick: number } | null | undefined): GoalBosses {
  const cfg = bossConfigOr(config);
  return { clatterhornOpen: cfg.clatterhornOpen, spireOpen: cfg.spireOpen, clatter: clatter ? { state: clatter.state, stateUntilTick: clatter.stateUntilTick } : null };
}

/** Your nearest pile of defeat drops among `groundItems`, or null. */
export function nearestBag(me: Tile, meHex: string, groundItems: Iterable<Tile & { id: number | bigint; droppedOnDeath: boolean; droppedBy: { toHexString(): string } }>): GoalBag | null {
  let best: GoalBag | null = null;
  for (const g of groundItems) {
    if (!g.droppedOnDeath || g.droppedBy.toHexString() !== meHex) continue;
    if (!best || chebyshev(me, g) < chebyshev(me, best)) best = { id: g.id, x: g.x, z: g.z };
  }
  return best;
}
