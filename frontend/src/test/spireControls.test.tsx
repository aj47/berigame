import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BossEventKind, BossId, BossNoticeKind, SpireMemberState } from '@sim';
import { identity, seedRun, spireFight } from './spireFixtures';

const mock = vi.hoisted(() => ({
  me: null as any, inventory: [] as any[],
  setTarget: vi.fn().mockResolvedValue(true), eat: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => mock.me, useInventoryRows: () => mock.inventory }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setTarget: mock.setTarget, eatBerry: mock.eat }) }));

import SpireControls, { bestFoodSlot } from '../bosses/spire/SpireControls';
import { spireView } from '../bosses/spire/spireView';
import { startSpireFx, spireClearLine } from '../bosses/spire/spireFx';
import { useBossStore } from '../bosses/bossStore';
import { useGiantStore } from '../spacetime/stores/giantStore';
import { useCombatFxStore } from '../spacetime/stores/combatFxStore';
import { flashStage } from '../fx/hitFlash';
import { tickClock } from '../spacetime/tickClock';

beforeEach(() => {
  mock.me = { identity: identity('me'), x: 74, z: 66, hp: 30 };
  mock.inventory = [{ slot: 2, itemId: 'berry_blueberry', quantity: 3 }, { slot: 5, itemId: 'berry_goldberry', quantity: 1 }, { slot: 1, itemId: 'stick', quantity: 1 }];
  mock.setTarget.mockClear(); mock.eat.mockClear();
  spireView.azimuth = 0;
  seedRun();
});
afterEach(() => { cleanup(); useBossStore.getState().reset(); });

describe('SpireControls', () => {
  it('a key tap sends one camera-relative 1-tile step', async () => {
    render(<SpireControls />);
    fireEvent.keyDown(window, { code: 'KeyW' });
    expect(mock.setTarget).toHaveBeenCalledWith(74, 65);
    fireEvent.keyUp(window, { code: 'KeyW' });
    await act(async () => {});
    spireView.azimuth = Math.PI / 2;
    fireEvent.keyDown(window, { code: 'ArrowUp' });
    expect(mock.setTarget).toHaveBeenLastCalledWith(73, 66);
  });

  it('Space holds position, F eats the best food, the pad steps too', async () => {
    render(<SpireControls />);
    fireEvent.keyDown(window, { code: 'Space' });
    expect(mock.setTarget).toHaveBeenLastCalledWith(74, 66);
    fireEvent.keyDown(window, { code: 'KeyF' });
    expect(mock.eat).toHaveBeenCalledWith(5);
    await act(async () => {});
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Step ↗' }), { pointerId: 1 });
    expect(mock.setTarget).toHaveBeenLastCalledWith(75, 65);
  });

  it('is disabled unless you are fighting, and while typing', () => {
    seedRun({}, { me: { state: SpireMemberState.Out } });
    render(<SpireControls />);
    fireEvent.keyDown(window, { code: 'KeyD' });
    expect(mock.setTarget).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Hold position' })).toBeDisabled();
    cleanup();
    seedRun();
    render(<><SpireControls /><input aria-label="chat" /></>);
    fireEvent.keyDown(screen.getByLabelText('chat'), { code: 'KeyD' });
    expect(mock.setTarget).not.toHaveBeenCalled();
  });

  it('picks the highest-healing food', () => {
    expect(bestFoodSlot(mock.inventory)).toBe(5);
    expect(bestFoodSlot([{ slot: 1, itemId: 'stick', quantity: 1 }])).toBe(-1);
  });
});

describe('spireFx', () => {
  it('posts the clear world line and flashes your Hurt and teammates\' hits', () => {
    const stop = startSpireFx();
    const before = useGiantStore.getState().systemLines.length;
    act(() => {
      const s = useBossStore.getState();
      s.pushEvent({ tick: 1, boss: BossId.Spire, kind: BossEventKind.SpireClear, runId: 3n, player: identity('x'), x: 0, z: 0, quantity: 3, value: 420, text: 'Ada, Bo, Cy' } as any);
      s.pushNotice({ tick: 1, boss: BossId.Spire, kind: BossNoticeKind.Hurt, player: identity('me'), runId: 7n, amount: 3, total: 0, hp: 27, half: 0, quantity: 4, itemId: '', x: 0, z: 0 } as any);
      s.setRow('spireFight', spireFight({ hits1: 1 }));
    });
    const lines = useGiantStore.getState().systemLines;
    expect(lines.length).toBe(before + 1);
    expect(lines[lines.length - 1].text).toBe("Ada's party cleared the Sunken Spire in 4:12");
    expect(useCombatFxStore.getState().numbers.me?.text).toBe('3');
    expect(useCombatFxStore.getState().numbers.ada?.text).toBe('3');
    // The flash lands with the half-step that hit (half 0 counts as 1: half a tick after arrival).
    expect(flashStage('me', performance.now() + tickClock.period / 2 + 20)).toBe(1);
    stop();
    expect(spireClearLine({ text: 'Ada', quantity: 1, value: 100 })).toBe('Ada cleared the Sunken Spire in 1:00');
  });
});
