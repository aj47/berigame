import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { stackAvatars, useStackedAvatars, STACK_SETTLE_TICKS, type StackInput } from '../Components/3D/avatarStacks';
import { avatarSelection } from '../Components/3D/playerSelection';

const at = (hex: string, x: number, z: number, extra: Partial<StackInput> = {}): StackInput =>
  ({ hex, x, z, region: 'bramblewild', active: false, settled: true, ...extra });

describe('stackAvatars', () => {
  it('draws one settled player per tile and folds the rest into it', () => {
    const shown = stackAvatars([at('c', 25, 25), at('a', 25, 25), at('b', 25, 25), at('d', 26, 25)]);
    expect([...shown]).toEqual([['a', ['b', 'c']], ['d', []]]);
  });

  it('always draws active and arriving players', () => {
    const shown = stackAvatars([at('a', 25, 25), at('b', 25, 25, { active: true }), at('c', 25, 25, { settled: false })]);
    expect(shown.get('a')).toEqual([]);
    expect(shown.get('b')).toEqual([]);
    expect(shown.get('c')).toEqual([]);
  });

  it('keeps regions apart', () => {
    const shown = stackAvatars([at('a', 5, 5), at('b', 5, 5, { region: 'settlement' })]);
    expect(shown.size).toBe(2);
  });
});

type Row = { identity: { toHexString(): string }; x: number; z: number; region: string; targetX?: number; combatTarget?: unknown };
const row = (hex: string, x: number, z: number, extra: Partial<Row> = {}): Row =>
  ({ identity: { toHexString: () => hex }, x, z, region: 'bramblewild', ...extra });

describe('useStackedAvatars', () => {
  it('folds a crowd already standing together on first sight', () => {
    const players = [row('a', 25, 25), row('b', 25, 25), row('c', 25, 25)];
    const { result } = renderHook(() => useStackedAvatars(players as any, null, null, 100));
    expect([...result.current]).toEqual([['a', ['b', 'c']]]);
  });

  it('never stacks you, and draws walkers, fighters and your target', () => {
    const players = [row('a', 25, 25), row('b', 25, 25, { targetX: 30 }), row('c', 25, 25, { combatTarget: {} }), row('d', 25, 25), row('me', 25, 25)];
    const { result } = renderHook(() => useStackedAvatars(players as any, 'me', 'd', 100));
    expect([...result.current.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('lets an arriving player finish walking in before folding it', () => {
    let players = [row('a', 25, 25), row('b', 24, 25, { targetX: 25 })];
    const { result, rerender } = renderHook(({ tick }) => useStackedAvatars(players as any, null, null, tick), { initialProps: { tick: 100 } });
    players = [row('a', 25, 25), row('b', 25, 25)];
    rerender({ tick: 101 });
    expect(result.current.has('b')).toBe(true);
    rerender({ tick: 101 + STACK_SETTLE_TICKS });
    expect([...result.current]).toEqual([['a', ['b']]]);
  });
});

describe('avatarSelection with a stack', () => {
  it('offers everyone standing on the clicked avatar’s tile', () => {
    const selected = avatarSelection({ hex: 'a', name: 'A', x: 25, z: 25, isSelf: false }, [], ['b', 'c']);
    expect(selected).toMatchObject({ connectionId: 'Choose player', playerChoices: ['a', 'b', 'c'], playerHex: undefined, groundTiles: [{ x: 25, z: 25 }] });
  });
});
