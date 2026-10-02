import { describe, expect, it } from 'vitest';
import { CLAIM_CYCLE_TICKS, firstDayGoal, type GoalInput, type GoalPlayer, type GoalTree } from '../goals';
import { emptySlots } from '../inventory';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { Pending, PlayerState, type Slot } from '../types';

const player = (over: Partial<GoalPlayer> = {}): GoalPlayer => ({
  x: 25, z: 25, hp: 20, maxHp: 30, state: PlayerState.Alive, weapon: '', pending: Pending.None, pendingId: 0,
  harvestTreeId: 0, harvestEndTick: 0, respawnTick: 300, lastInputTick: 0, ...over,
});
const trees = (): GoalTree[] => TREE_SEEDS.map((t) => ({ ...t, cooldownUntilTick: 0 }));
const bag = (...items: string[]): Slot[] => {
  const s = emptySlots();
  items.forEach((itemId, i) => { s[i] = { itemId, quantity: 1 }; });
  return s;
};
const input = (over: Partial<GoalInput> = {}): GoalInput => ({
  me: player(), slots: emptySlots(), trees: trees(), others: [], tick: 10, canFight: true, done: [], ...over,
});

describe('First Day goal chip', () => {
  it('starts with "Pick a berry" and taps to the nearest ripe tree', () => {
    const { goal } = firstDayGoal(input());
    expect(goal).toMatchObject({ id: 'pick-berry', text: 'Pick a berry', action: { kind: 'harvest', treeId: 3 } });
  });

  it('walks through all five steps from state and remembers them', () => {
    let r = firstDayGoal(input({ slots: bag('berry_goldberry') }));
    expect(r.goal).toMatchObject({ id: 'eat-berry', text: 'Eat it: tap the Goldberry in your quick bar', action: { kind: 'eat', slot: 0 } });
    r = firstDayGoal(input({ done: r.done, me: player({ hp: 30 }) }));
    expect(r.goal).toMatchObject({ id: 'find-stick', action: { kind: 'harvest' } });
    expect(r.done).toEqual(['pick-berry', 'eat-berry']);
    r = firstDayGoal(input({ done: r.done, slots: bag('stick') }));
    expect(r.goal).toMatchObject({ id: 'wield-stick', action: { kind: 'wield', slot: 0 } });
    r = firstDayGoal(input({ done: r.done, slots: bag('stick'), me: player({ weapon: 'stick' }) }));
    expect(r.goal).toMatchObject({ id: 'reach-coast', text: 'Push through the brambles to the Coast', action: { kind: 'move', x: 25, z: 7 } });
    r = firstDayGoal(input({ done: r.done, slots: bag('stick'), me: player({ weapon: 'stick', x: 3, z: 25 }) }));
    // M2: First Day continues on the Coast.
    expect(r.goal).toMatchObject({ id: 'gather-coast', text: 'Gather driftwood and 2 flint on the Coast (0/3)' });
    expect(r.done).toContain('first-day');
  });

  it('after First Day: gather driftwood, then flint, then make and wield the club', () => {
    const all = ['pick-berry', 'eat-berry', 'find-stick', 'wield-stick', 'reach-coast', 'first-day'];
    const nodes: GoalTree[] = [...trees(), ...NODE_SEEDS.map((n) => ({ ...n, cooldownUntilTick: 0 }))];
    const me = player({ weapon: 'stick', x: 5, z: 20 });
    let r = firstDayGoal(input({ done: all, trees: nodes, me, slots: bag('stick') }));
    expect(r.goal).toMatchObject({ id: 'gather-coast', text: 'Gather driftwood and 2 flint on the Coast (0/3)', action: { kind: 'harvest', treeId: 104 } });
    const s = bag('stick', 'driftwood');
    s[2] = { itemId: 'flint', quantity: 1 };
    r = firstDayGoal(input({ done: all, trees: nodes, me, slots: s }));
    expect(r.goal).toMatchObject({ text: 'Gather driftwood and 2 flint on the Coast (2/3)', action: { kind: 'harvest', treeId: 105 } });
    s[2] = { itemId: 'flint', quantity: 2 };
    r = firstDayGoal(input({ done: all, trees: nodes, me, slots: s }));
    expect(r.goal).toMatchObject({ id: 'make-club', text: 'Make a stone club', action: { kind: 'craft', recipe: 'stone_club' } });
    r = firstDayGoal(input({ done: all, trees: nodes, me, slots: bag('stick', 'stone_club') }));
    expect(r.goal).toMatchObject({ id: 'wield-club', action: { kind: 'wield', slot: 1 } });
    r = firstDayGoal(input({ done: all, trees: nodes, me: player({ weapon: 'stone_club' }), slots: bag('stick', 'stone_club') }));
    expect(r.goal).toMatchObject({ id: 'reach-boulders', text: 'Take your club to the Boulders', action: { kind: 'move', x: 51, z: 51 } });
  });

  it.each([
    { itemId: 'stick', goalId: 'wield-stick', name: 'stick', done: ['pick-berry', 'eat-berry'] },
    { itemId: 'stone_club', goalId: 'wield-club', name: 'stone club', done: ['pick-berry', 'eat-berry', 'find-stick', 'wield-stick', 'reach-coast', 'first-day'] },
  ])('asks to assign a bagged $itemId before offering to wield it', ({ itemId, goalId, name, done }) => {
    const slots = emptySlots();
    slots[4] = { itemId, quantity: 1 };
    if (itemId === 'stone_club') slots[5] = { itemId: 'stick', quantity: 1 };
    const before = firstDayGoal(input({ slots, done }));
    expect(before.goal).toMatchObject({
      id: goalId,
      text: `Add your ${name} to a quick slot`,
      hint: 'Open your bag, then drag it to slots 1–3',
      action: null,
    });
    slots[2] = slots[4];
    slots[4] = null;
    const after = firstDayGoal(input({ slots, done: before.done }));
    expect(after.goal).toMatchObject({
      id: goalId,
      text: `Wield your ${name}: tap it`,
      action: { kind: 'wield', slot: 2 },
    });
  });

  it('M3/F3: in the Boulders, face the Giant; while it rests, chip obsidian; offers an adventure once you hold obsidian', () => {
    const all = ['pick-berry', 'eat-berry', 'find-stick', 'wield-stick', 'reach-coast', 'first-day'];
    const nodes: GoalTree[] = [...trees(), ...NODE_SEEDS.map((n) => ({ ...n, cooldownUntilTick: 0 }))];
    const me = player({ weapon: 'stone_club', x: 52, z: 52 });
    let r = firstDayGoal(input({ done: all, trees: nodes, me, slots: bag('stick', 'stone_club'), giant: { id: 1, state: 0 } }));
    expect(r.goal).toMatchObject({ id: 'face-giant', action: { kind: 'giant', giantId: 1 } });
    r = firstDayGoal(input({ done: all, trees: nodes, me: player({ weapon: 'stone_club', x: 52, z: 52, pending: 4, pendingId: 1n }), slots: bag('stick', 'stone_club'), giant: { id: 1, state: 0 } }));
    expect(r.goal).toMatchObject({ id: 'face-giant', action: null });
    r = firstDayGoal(input({ done: all, trees: nodes, me, slots: bag('stick', 'stone_club'), giant: { id: 1, state: 3 } }));
    expect(r.goal).toMatchObject({ id: 'gather-obsidian', action: { kind: 'harvest' } });
    expect([109, 110]).toContain((r.goal!.action as any).treeId);
    r = firstDayGoal(input({ done: all, trees: nodes, me, slots: bag('stick', 'stone_club', 'obsidian'), giant: { id: 1, state: 0 } }));
    expect(r.goal).toMatchObject({ id: 'camp-adventure', action: { kind: 'move', x: 22, z: 18 } });
    // Without the combat grant the club never needs wielding; the Boulders are still the next step.
    r = firstDayGoal(input({ done: all, trees: nodes, canFight: false, me: player({ x: 5, z: 20 }), slots: bag('stick', 'stone_club') }));
    expect(r.goal).toMatchObject({ id: 'reach-boulders' });
  });

  it('berry steps never target Coast nodes', () => {
    const nodes: GoalTree[] = [...NODE_SEEDS.map((n) => ({ ...n, cooldownUntilTick: 0 })), ...trees()];
    const r = firstDayGoal(input({ trees: nodes, me: player({ x: 4, z: 25 }) }));
    expect(r.goal?.action).toMatchObject({ kind: 'harvest' });
    expect((r.goal?.action as { treeId: number }).treeId).toBeLessThan(100);
  });

  it('skips the wield step without the combat grant', () => {
    const r = firstDayGoal(input({ done: ['pick-berry', 'eat-berry'], slots: bag('stick'), canFight: false }));
    expect(r.goal?.id).toBe('reach-coast');
  });

  it('skips "search" when the first harvest found the stick', () => {
    const r = firstDayGoal(input({ slots: bag('berry_blueberry', 'stick'), me: player({ hp: 30 }) }));
    expect(r.goal?.id).toBe('wield-stick');
  });

  it('eating the berry never un-completes a step during First Day', () => {
    const r = firstDayGoal(input({ done: ['pick-berry', 'eat-berry', 'find-stick'], slots: bag('stick'), me: player({ hp: 22 }) }));
    expect(r.goal?.id).toBe('wield-stick');
  });

  it('losing the stick before the Coast (a death drop) goes back to searching, not an impossible "push through"', () => {
    const before = ['pick-berry', 'eat-berry', 'find-stick', 'wield-stick'];
    let r = firstDayGoal(input({ done: before, me: player({ hp: 30 }) }));
    expect(r.goal?.id).toBe('find-stick');
    expect(r.done).not.toContain('find-stick');
    r = firstDayGoal(input({ done: ['pick-berry', 'eat-berry', 'find-stick'], me: player({ hp: 30 }) }));
    expect(r.goal?.id).toBe('find-stick');
    // A new stick picks up where it left off.
    r = firstDayGoal(input({ done: before, slots: bag('stick'), me: player({ hp: 30 }) }));
    expect(r.goal?.id).toBe('reach-coast');
  });

  it('after First Day, a player with no stick sees "search" and "push through" again', () => {
    const all = ['pick-berry', 'eat-berry', 'find-stick', 'wield-stick', 'reach-coast', 'first-day'];
    let r = firstDayGoal(input({ done: all }));
    expect(r.goal?.id).toBe('find-stick');
    r = firstDayGoal(input({ done: r.done, slots: bag('stick') }));
    expect(r.goal?.id).toBe('reach-coast');
  });

  it('shows "Waiting: ripe in N s" beside a regrowing tree', () => {
    const t = trees();
    t[3].cooldownUntilTick = 60; // blueberry (30,25)
    const r = firstDayGoal(input({ trees: t.map((x) => ({ ...x, cooldownUntilTick: 60 })), me: player({ x: 29, z: 25, pending: Pending.Harvest, pendingId: 4n }) }));
    expect(r.goal).toMatchObject({ hint: 'Waiting: ripe in 30 s', action: null, waiting: { treeId: 4, ripeInTicks: 50 } });
  });

  it('re-targets only when another tree is at least a claim cycle sooner', () => {
    const t = trees().map((x) => ({ ...x, cooldownUntilTick: 1000 }));
    const waiting = player({ x: 29, z: 25, pending: Pending.Harvest, pendingId: 4n });
    // Strawberry 1 at (40,30) is free now; walking there takes 5 ticks: claim at 15.
    t[0].cooldownUntilTick = 10;
    t[3].cooldownUntilTick = 15 + CLAIM_CYCLE_TICKS - 1;
    expect(firstDayGoal(input({ trees: t, me: waiting })).goal?.action).toBeNull();
    t[3].cooldownUntilTick = 15 + CLAIM_CYCLE_TICKS;
    expect(firstDayGoal(input({ trees: t, me: waiting })).goal?.action).toEqual({ kind: 'harvest', treeId: 1 });
  });

  it('counts waiters ahead: another newcomer already waiting pushes me to a free tree', () => {
    const t = trees().map((x) => ({ ...x, cooldownUntilTick: 60 }));
    const other = player({ x: 29, z: 25, pending: Pending.Harvest, pendingId: 4n });
    const r = firstDayGoal(input({ trees: t, me: player({ x: 28, z: 25 }), others: [other] }));
    expect(r.goal?.action).not.toEqual({ kind: 'harvest', treeId: 4 });
  });

  it('finds another edible berry after planting or gifting the first one', () => {
    const r = firstDayGoal(input({ done: ['pick-berry'], slots: bag() }));
    expect(r.goal).toMatchObject({ id: 'eat-berry', action: { kind: 'harvest' } });
  });

  it('is hidden while dead', () => {
    expect(firstDayGoal(input({ me: player({ state: PlayerState.Dead }) })).goal).toBeNull();
  });
});
