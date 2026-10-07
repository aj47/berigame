import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItemDef } from '@sim';
import Inventory from '../Components/Inventory';
import CombatHud from '../Components/CombatHud';

const mock = vi.hoisted(() => ({
  rows: [] as any[],
  moveItem: vi.fn().mockResolvedValue(true), eatBerry: vi.fn().mockResolvedValue(true),
  wieldItem: vi.fn().mockResolvedValue(true), unwield: vi.fn().mockResolvedValue(true),
  dropItem: vi.fn().mockResolvedValue(true), cancel: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useInventoryRows: () => mock.rows,
  useMyEnergy: () => undefined,
  useNow: () => 0,
  useMyPlayer: () => ({ hp: 15, maxHp: 30, state: 0, weapon: '', x: 25, z: 25 }),
  usePlayersByHex: () => new Map(), useTick: () => 100,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));

class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; isPrimary: boolean;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init); this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = init.isPrimary ?? true;
  }
}
let target: Element | null;
const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10 };
const move = (extra = {}) => fireEvent.pointerMove(window, { ...pointer, clientX: 60, clientY: 30, ...extra });
const release = async (extra = {}) => {
  await act(async () => { fireEvent.pointerUp(window, { ...pointer, clientX: 60, clientY: 30, ...extra }); });
};
const bag = (index: number) => within(screen.getByRole('region', { name: 'Inventory' })).getAllByRole('button').find(el => el.dataset.inventorySlot === String(index))!;
const hud = (index: number) => screen.getByRole('button', { name: new RegExp(`^Quick slot ${index + 1}:`) });
const panel = (open = true) => <Inventory open={open} onClose={() => {}} />;

beforeEach(() => {
  vi.clearAllMocks();
  mock.moveItem.mockReset().mockResolvedValue(true);
  mock.rows = [{ slot: 0, itemId: 'berry_blueberry', quantity: 3 }, { slot: 5, itemId: 'stick', quantity: 1 }];
  target = null;
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete (document as any).elementFromPoint; });

describe('inventory dragging', () => {
  it.each([[5, 6], [5, 0], [0, 5], [0, 2]])('moves bag/quick slot %i to %i without using or dropping an item', async (from, to) => {
    render(panel());
    const source = bag(from); target = bag(to);
    fireEvent.pointerDown(source, pointer); move();
    expect(target).toHaveAttribute('data-drop-target', 'allowed');
    await release();
    fireEvent.click(source, { detail: 1 });
    expect(mock.moveItem).toHaveBeenCalledExactlyOnceWith(from, to);
    expect(mock.eatBerry).not.toHaveBeenCalled(); expect(mock.wieldItem).not.toHaveBeenCalled(); expect(mock.dropItem).not.toHaveBeenCalled();
  });

  it('uses the same drop targets across the bag and HUD, including quick-slot reordering', async () => {
    mock.rows.push({ slot: 1, itemId: 'driftwood', quantity: 2 });
    render(<>{panel()}<CombatHud onOpenBag={() => {}} /></>);
    target = hud(2); fireEvent.pointerDown(bag(5), pointer); move(); await release();
    expect(mock.moveItem).toHaveBeenLastCalledWith(5, 2);
    target = bag(6); fireEvent.pointerDown(hud(1), pointer); move(); await release();
    expect(mock.moveItem).toHaveBeenLastCalledWith(1, 6);
    target = hud(1); const source = hud(0); fireEvent.pointerDown(source, pointer); move(); await release();
    fireEvent.click(source, { detail: 1 });
    expect(mock.moveItem).toHaveBeenLastCalledWith(0, 1);
    expect(mock.eatBerry).not.toHaveBeenCalled(); expect(mock.wieldItem).not.toHaveBeenCalled();
  });

  it.each(['outside', 'same', 'full stack'])('cancels a drop on %s without changing the inventory', async (kind) => {
    if (kind === 'full stack') mock.rows = [{ slot: 0, itemId: 'berry_blueberry', quantity: getItemDef('berry_blueberry')!.maxStack }, { slot: 5, itemId: 'berry_blueberry', quantity: 2 }];
    render(panel()); target = kind === 'outside' ? null : bag(kind === 'same' ? 5 : 0);
    fireEvent.pointerDown(bag(5), pointer); move(); await release();
    expect(mock.moveItem).not.toHaveBeenCalled();
    expect(document.querySelector('.inventory-drag-preview')).not.toBeInTheDocument();
  });

  it('drops the whole stack when released on the world floor from the bag or HUD', async () => {
    render(<>{panel()}<CombatHud onOpenBag={() => {}} /></>);
    const floor = document.createElement('div'); floor.dataset.worldFloor = '';
    const canvas = floor.appendChild(document.createElement('canvas')); document.body.appendChild(floor);
    target = canvas; fireEvent.pointerDown(bag(0), pointer); move();
    expect(document.querySelector('.inventory-drag-preview')).toHaveTextContent('Drop all 3 on the ground');
    await release();
    expect(mock.dropItem).toHaveBeenLastCalledWith(0, 3);
    fireEvent.pointerDown(hud(0), pointer); move(); await release();
    expect(mock.dropItem).toHaveBeenCalledTimes(2);
    expect(mock.moveItem).not.toHaveBeenCalled();
    floor.remove();
  });

  it('stacks matching items through the server move and waits for its result', async () => {
    mock.rows[1] = { slot: 5, itemId: 'berry_blueberry', quantity: 4 };
    let resolve!: (value: boolean) => void;
    mock.moveItem.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render(panel()); target = bag(0);
    fireEvent.pointerDown(bag(5), pointer); move(); await release();
    expect(mock.moveItem).toHaveBeenCalledExactlyOnceWith(5, 0);
    expect(bag(5)).toHaveAccessibleName('Slot 6: Blueberry, 4');
    expect(bag(5)).toBeDisabled();
    fireEvent.pointerDown(bag(5), pointer); move(); await release();
    expect(mock.moveItem).toHaveBeenCalledOnce();
    await act(async () => resolve(false));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not update your bag');
    expect(bag(5)).toBeEnabled();
  });

  it.each(['Escape', 'cancel', 'blur', 'close', 'source changes', 'second touch'])('cancels safely on %s', async (reason) => {
    const { rerender } = render(panel()); target = bag(0);
    fireEvent.pointerDown(bag(5), pointer); move();
    if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (reason === 'cancel') fireEvent.pointerCancel(window, pointer);
    if (reason === 'blur') fireEvent.blur(window);
    if (reason === 'second touch') fireEvent.pointerDown(window, { ...pointer, pointerId: 2, isPrimary: false });
    if (reason === 'close') rerender(panel(false));
    if (reason === 'source changes') { mock.rows = mock.rows.filter(row => row.slot !== 5); rerender(panel()); }
    await release();
    expect(mock.moveItem).not.toHaveBeenCalled();
    expect(document.querySelector('.inventory-drag-preview')).not.toBeInTheDocument();
  });

  it('leaves clicks and keyboard actions available when no drag starts', async () => {
    render(panel()); const source = bag(5);
    fireEvent.pointerDown(source, pointer); fireEvent.pointerMove(window, { ...pointer, clientX: 12 });
    await release({ clientX: 12, clientY: 10 }); fireEvent.click(source, { detail: 1 });
    expect(mock.moveItem).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
  });

  it('holds to drag on touch, but an immediate swipe only scrolls', async () => {
    vi.useFakeTimers(); render(panel());
    const touch = { ...pointer, pointerType: 'touch' }, source = bag(5);
    const grid = screen.getByLabelText('Inventory slots');
    target = bag(0); fireEvent.pointerDown(source, touch);
    move({ pointerType: 'touch', clientY: -40 });
    await act(async () => vi.advanceTimersByTime(300));
    await release({ pointerType: 'touch', clientY: -40 });
    expect(grid.scrollTop).toBeGreaterThan(0); expect(mock.moveItem).not.toHaveBeenCalled();
    fireEvent.pointerDown(source, touch);
    await act(async () => vi.advanceTimersByTime(300));
    move({ pointerType: 'touch' }); await release({ pointerType: 'touch' });
    expect(mock.moveItem).toHaveBeenCalledExactlyOnceWith(5, 0);
  });
});
