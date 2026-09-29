import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DUMMY_MAX_HP, Emote, GROUND_ITEM_TTL_TICKS, PlayerState, STICK_ITEM_ID } from '@sim';
import { bagLifeLeft, compassAngle, deathBagOf, formatTicks, useCameraLook } from '../spacetime/deathBag';
import { useSocialStore } from '../spacetime/stores/socialStore';
import { useCombatFxStore } from '../spacetime/stores/combatFxStore';

const mock = vi.hoisted(() => ({
  tick: 100,
  me: 'aa',
  player: { x: 25, z: 25, state: 0, respawnTick: 0, hp: 30, maxHp: 30 } as any,
  items: [] as any[],
  emote: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.player,
  useTick: () => mock.tick,
  useGroundItems: () => mock.items,
  useMyIdentityHex: () => mock.me,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ emote: mock.emote }) }));
vi.mock('../store', () => ({ useLoadingStore: (pick: any) => pick({ isLoading: false }) }));
import SocialHud from '../Components/SocialHud';

const id = (hex: string) => ({ toHexString: () => hex });
const pile = (x: number, z: number, droppedTick: number, by = 'aa', onDeath = true) =>
  ({ id: BigInt(x * 100 + z), itemId: 'berry_blueberry', quantity: 1, x, z, droppedBy: id(by), droppedTick, expiresTick: droppedTick + GROUND_ITEM_TTL_TICKS, droppedOnDeath: onDeath });

afterEach(cleanup);
beforeEach(() => {
  mock.items = [];
  mock.player = { x: 25, z: 25, state: 0, respawnTick: 0, hp: 30, maxHp: 30 };
  mock.emote.mockClear();
  useCameraLook.setState({ x: 0, z: -1 });
});

describe('death bag', () => {
  it('finds only your own death drops from the latest defeat', () => {
    expect(deathBagOf([pile(10, 10, 50, 'bb'), pile(11, 11, 50, 'aa', false)], 'aa')).toBeNull();
    const bag = deathBagOf([pile(9, 10, 40), pile(30, 30, 60), pile(31, 30, 60), pile(30, 31, 60)], 'aa')!;
    expect(bag).toMatchObject({ x: 30, z: 30, piles: 3, droppedTick: 60, expiresTick: 60 + GROUND_ITEM_TTL_TICKS });
    expect(bagLifeLeft(bag, 60)).toBe(1);
    expect(bagLifeLeft(bag, 60 + GROUND_ITEM_TTL_TICKS)).toBe(0);
  });

  it('points the compass relative to the camera', () => {
    const me = { x: 25, z: 25 };
    expect(compassAngle(me, { x: 25, z: 20 }, { x: 0, z: -1 })).toBeCloseTo(0);
    expect(compassAngle(me, { x: 30, z: 25 }, { x: 0, z: -1 })).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(compassAngle(me, { x: 25, z: 30 }, { x: 0, z: -1 }))).toBeCloseTo(Math.PI);
    // Camera looking east: something to the north is on the left.
    expect(compassAngle(me, { x: 25, z: 20 }, { x: 1, z: 0 })).toBeCloseTo(-Math.PI / 2);
    expect(formatTicks(500)).toBe('5:00');
    expect(formatTicks(5)).toBe('3s');
  });

  it('shows the defeat panel with the bag and the respawn countdown, then a compass', () => {
    mock.player = { ...mock.player, x: 20, z: 20, state: PlayerState.Dead, respawnTick: 104 };
    mock.items = [pile(20, 21, 99)];
    const { rerender } = render(<SocialHud />);
    expect(screen.getByText('You were defeated')).toBeTruthy();
    expect(screen.getByTestId('death-panel').textContent).toContain('Your bag lies at 20,21');
    expect(screen.getByTestId('death-panel').textContent).toContain('Back on your feet in 3s');
    mock.player = { ...mock.player, x: 25, z: 25, state: PlayerState.Alive };
    rerender(<SocialHud />);
    expect(screen.queryByText('You were defeated')).toBeNull();
    expect(screen.getByTestId('death-panel').textContent).toMatch(/Your bag · 20,21 · 5 tiles · 5:00 left/);
    fireEvent.click(screen.getByLabelText('Hide the bag compass'));
    expect(screen.queryByTestId('death-panel')).toBeNull();
  });

  it('shows nothing once the piles are gone', () => {
    render(<SocialHud />);
    expect(screen.queryByTestId('death-panel')).toBeNull();
  });
});

describe('emote wheel', () => {
  it('opens with E and picks with a digit before the quick bar sees it', () => {
    const quickBar = vi.fn();
    window.addEventListener('keydown', quickBar);
    render(<SocialHud />);
    fireEvent.keyDown(window, { key: 'e' });
    expect(screen.getByRole('menu', { name: 'Emotes' })).toBeTruthy();
    fireEvent.keyDown(window, { key: '3' });
    expect(mock.emote).toHaveBeenCalledWith(Emote.Sit);
    expect(quickBar).toHaveBeenCalledTimes(1); // only the E
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Emotes (E)' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Wave/ }));
    expect(mock.emote).toHaveBeenLastCalledWith(Emote.Wave);
    window.removeEventListener('keydown', quickBar);
  });
});

describe('social store', () => {
  it('plays emotes and clears them', () => {
    vi.useFakeTimers();
    act(() => useSocialStore.getState().pushEmote({ tick: 1, player: id('bb') as any, emote: Emote.Wave }));
    expect(useSocialStore.getState().emotes.bb.emote).toBe(Emote.Wave);
    act(() => { vi.advanceTimersByTime(2500); });
    expect(useSocialStore.getState().emotes.bb).toBeUndefined();
    act(() => useSocialStore.getState().pushEmote({ tick: 1, player: id('bb') as any, emote: 77 }));
    expect(useSocialStore.getState().emotes.bb).toBeUndefined();
    vi.useRealTimers();
  });

  it('a dummy hit floats the damage and swings the attacker like a real blow', () => {
    act(() => useSocialStore.getState().pushDummyHit({ tick: 1, dummyId: 1, attacker: id('cc') as any, damage: 6, itemId: STICK_ITEM_ID, hp: DUMMY_MAX_HP - 6, reset: false }));
    expect(useSocialStore.getState().dummyHits[1]).toMatchObject({ damage: 6, hp: DUMMY_MAX_HP - 6 });
    expect(useCombatFxStore.getState().cues.cc).toMatchObject({ clip: 'StickSwing', role: 'action' });
  });
});
