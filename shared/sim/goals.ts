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
import { GIANT_ID, GiantState } from './giant';
import { HARVEST_TICKS, HOTBAR_SIZE, MELEE_RANGE, MOVEMENT_STEPS_PER_TICK, TICK_MS, TREE_COOLDOWN_TICKS } from './constants';
import { chebyshev } from './grid';
import { DRIFTWOOD_ITEM_ID, FLINT_ITEM_ID, getItemDef, OBSIDIAN_ITEM_ID, STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from './items';
import { countItem } from './inventory';
import { canCraft, getRecipe, harvestTicksFor, isBerryNode, NodeKind, regrowTicksFor } from './nodes';
import { Pending, PlayerState, type Slot, type Tile } from './types';
import { harvestXp, xpForLevel } from './skills';

export type GoalStepId = 'pick-berry' | 'eat-berry' | 'find-stick' | 'wield-stick' | 'reach-coast'
  // M2, after First Day:
  | 'gather-coast' | 'make-club' | 'wield-club'
  // M3 / F3, after the club:
  | 'reach-boulders' | 'camp-adventure' | 'face-giant' | 'gather-obsidian';
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
  | { kind: 'giant'; giantId: number };

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
}

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

/** Estimated tick at which `me` could claim `tree`: max(ripening, arrival) + one cycle per waiter ahead. */
export function claimEstimate(me: GoalPlayer, tree: GoalTree, others: readonly GoalPlayer[], tick: number): number {
  const ready = treeReadyTick(tree, [me, ...others], tick);
  const walk = Math.ceil(Math.max(0, chebyshev(me, tree) - MELEE_RANGE) / MOVEMENT_STEPS_PER_TICK);
  const meWaiting = me.pending === Pending.Harvest && sameNum(me.pendingId, tree.id);
  const meNew = isNewcomer(me, tick);
  let ahead = 0;
  for (const o of others) {
    if (o.online === false || o.state !== PlayerState.Alive) continue;
    if (o.pending !== Pending.Harvest || !sameNum(o.pendingId, tree.id)) continue;
    const oNew = isNewcomer(o, tick);
    if (oNew && !meNew) ahead++;
    else if (oNew === meNew && (!meWaiting || o.lastInputTick <= me.lastInputTick)) ahead++;
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
          hint: ripeIn > 0 ? `Waiting: ripe in ${seconds(ripeIn)} s` : 'Waiting for your turn…',
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

/**
 * After First Day (M2): "Gather driftwood and 2 flint on the Coast" (n/3),
 * then "Make a stone club", then wield it. M3 continues with the boulders.
 */
function coastGoal(input: GoalInput, hasStick: boolean): Goal | null {
  const { me, slots, canFight } = input;
  if (holdsItem(slots, me.weapon, STONE_CLUB_ITEM_ID)) {
    if (!canFight || me.weapon === STONE_CLUB_ITEM_ID) return bouldersGoal(input);
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
 * M3 / F3, for a club holder: take it to the Boulders, then face the Giant (or,
 * while it rests, chip obsidian). Done once you hold obsidian.
 */
function bouldersGoal(input: GoalInput): Goal | null {
  const { me, slots } = input;
  if (countItem(slots, OBSIDIAN_ITEM_ID) > 0) return { id: 'camp-adventure', text: 'Visit the gardener: a giant berry adventure awaits', hint: 'Open Adventure at camp. Obsidian helps build the shared workshop.', action: { kind: 'move', x: 22, z: 18 } };
  if (areaOf(me) !== 'boulders') {
    return {
      id: 'reach-boulders',
      text: 'Take your club to the Boulders',
      hint: 'Tap to climb over the boulders past the Coast\'s south-east corner',
      action: { kind: 'move', x: BOULDERS_ENTRY.x, z: BOULDERS_ENTRY.z },
    };
  }
  if (input.giant && input.giant.state === GiantState.Defeated) {
    return gatherGoal('gather-obsidian', 'The Giant rests: chip obsidian from an outcrop', 'No outcrop is ready yet', input, NodeKind.Obsidian);
  }
  if (input.giant && input.giant.state === GiantState.Asleep) {
    return gatherGoal('gather-obsidian', 'The Giant sleeps: chip obsidian from an outcrop', 'No outcrop is ready yet', input, NodeKind.Obsidian);
  }
  if (me.pending === Pending.Giant) {
    return { id: 'face-giant', text: 'Face the Giant', hint: 'Step out of the red mark before it lands', action: null };
  }
  return {
    id: 'face-giant',
    text: 'Face the Giant (everyone who helps gets obsidian)',
    hint: 'Tap to fight. Step out of the red mark before it lands',
    action: { kind: 'giant', giantId: input.giant?.id ?? GIANT_ID },
  };
}
