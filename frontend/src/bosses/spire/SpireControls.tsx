import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { SPIRE_MEALS, SpireMemberState, getItemDef, type Tile } from '@sim';
import { useInventoryRows, useMyPlayer } from '../../spacetime/hooks';
import { useGameActions } from '../../spacetime/actions';
import { tickClock } from '../../spacetime/tickClock';
import { isTyping } from '../../Components/keyboard';
import { useBossStore } from '../bossStore';
import { createStepSender, stepDelta, stepTarget, type StepKeys } from './stepInput';
import { spireView } from './spireView';
import '../bosses.css';

/**
 * Step controls inside the Spire (FINAL_SPEC 7.6): WASD or arrows map to the
 * 8 grid directions relative to the camera azimuth; a tap steps 1 tile,
 * holding steps 2 tiles once per tick, Shift keeps 1-tile steps, Space holds
 * position, F eats the best healing item while meals remain. Touch: an 8-way
 * pad (bottom left, 132 px) plus Hold and Eat. One setTarget in flight; the
 * latest intent replaces a queued one. `me` is always the authoritative row tile.
 */
export type SpireControlsProps = Record<string, never>;

const KEY_DIR: Record<string, keyof StepKeys> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
/** Pad cells in screen space (row by row), null in the middle (Hold). */
const PAD: (Partial<StepKeys> & { label: string } | null)[] = [
  { up: true, left: true, label: '↖' }, { up: true, label: '↑' }, { up: true, right: true, label: '↗' },
  { left: true, label: '←' }, null, { right: true, label: '→' },
  { down: true, left: true, label: '↙' }, { down: true, label: '↓' }, { down: true, right: true, label: '↘' },
];
const NONE: StepKeys = { up: false, down: false, left: false, right: false };

/** The bag slot of the best healing item (highest heal, then lowest slot), or -1. */
export function bestFoodSlot(rows: readonly { slot: number; itemId: string; quantity: number }[]): number {
  let best = -1, heal = 0;
  for (const r of rows) {
    const h = r.quantity > 0 ? getItemDef(r.itemId)?.healthRestore ?? 0 : 0;
    if (h > heal || (h === heal && h > 0 && r.slot < best)) { best = r.slot; heal = h; }
  }
  return best;
}

export default function SpireControls(_props: SpireControlsProps) {
  const me = useMyPlayer();
  const inventory = useInventoryRows();
  const { setTarget, eatBerry } = useGameActions();
  const member = useBossStore((s) => s.myMember);
  const enabled = member?.state === SpireMemberState.In && !!me && me.hp > 0;
  const mealsLeft = Math.max(0, SPIRE_MEALS - (member?.meals ?? 0));
  const food = bestFoodSlot(inventory);

  const live = useRef({ me: null as Tile | null, enabled, food, mealsLeft, eatBerry });
  live.current = { me: me ? { x: me.x, z: me.z } : null, enabled, food, mealsLeft, eatBerry };
  const setTargetRef = useRef(setTarget);
  setTargetRef.current = setTarget;
  const sender = useMemo(() => createStepSender((x, z) => Promise.resolve(setTargetRef.current(x, z))), []);

  const held = useRef<{ keys: StepKeys; shift: boolean; pad: StepKeys | null }>({ keys: { ...NONE }, shift: false, pad: null });
  const step = (keys: StepKeys, hold: boolean, shift: boolean) => {
    const { me: at, enabled: on } = live.current;
    if (!on || !at) return;
    const delta = stepDelta(keys, spireView.azimuth);
    if (delta) sender.send(stepTarget(at, delta, hold, shift));
  };
  const holdPosition = () => { const at = live.current.me; if (live.current.enabled && at) sender.send(at); };
  const eat = () => {
    const { food: slot, mealsLeft: left, enabled: on, eatBerry: eatNow } = live.current;
    if (on && left > 0 && slot >= 0) void eatNow(slot);
  };

  // Holding: one 2-tile intent per server tick while a direction stays down.
  useEffect(() => {
    let raf = 0, lastTick = tickClock.tick;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (tickClock.tick === lastTick) return;
      lastTick = tickClock.tick;
      const h = held.current, keys = h.pad ?? h.keys;
      if (keys.up || keys.down || keys.left || keys.right) step(keys, true, h.shift);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const h = held.current;
      h.shift = e.shiftKey;
      const dir = KEY_DIR[e.code];
      if (dir) {
        e.preventDefault();
        if (e.repeat || h.keys[dir]) return;
        h.keys = { ...h.keys, [dir]: true };
        step(h.keys, false, e.shiftKey);
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) holdPosition();
      } else if (e.code === 'KeyF' && !e.repeat) {
        eat();
      }
    };
    const up = (e: KeyboardEvent) => {
      const h = held.current;
      h.shift = e.shiftKey;
      const dir = KEY_DIR[e.code];
      if (dir) h.keys = { ...h.keys, [dir]: false };
    };
    const blur = () => { held.current.keys = { ...NONE }; held.current.pad = null; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const press = (cell: Partial<StepKeys>) => (e: ReactPointerEvent) => {
    e.preventDefault();
    const keys = { ...NONE, ...cell };
    held.current.pad = keys;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    step(keys, false, false);
  };
  const release = () => { held.current.pad = null; };

  return <div className="spire-controls" data-testid="spire-controls">
    <div className="spire-pad" role="group" aria-label="Step pad">
      {PAD.map((cell, i) => cell
        ? <button key={i} type="button" aria-label={`Step ${cell.label}`} disabled={!enabled}
            onPointerDown={press(cell)} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>{cell.label}</button>
        : <button key={i} type="button" className="spire-pad-hold" aria-label="Hold position" disabled={!enabled} onClick={holdPosition}>Hold</button>)}
    </div>
    <div className="spire-side">
      <button type="button" disabled={!enabled || mealsLeft === 0 || food < 0} onClick={eat} aria-label={`Eat (${mealsLeft} meals left)`}>Eat</button>
    </div>
  </div>;
}
