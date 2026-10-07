import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Euler, Object3D, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BossEventKind, BossId, BossNoticeKind, ClatterState, HurtSource, clatterSwarmBullets, tileToWorld } from '@sim';

const mock = vi.hoisted(() => ({ now: 1000, frames: [] as any[], bullets: [] as any[], clock: { tick: 101, period: 600, arrivedAt: 0 }, play: [] as any[] }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: any) => { mock.frames.push(frame); } }));
vi.mock('@react-three/drei', () => ({ Html: ({ children }: any) => <div>{children}</div> }));
vi.mock('../spacetime/tickClock', () => ({ tickClock: mock.clock }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayerSelector: () => 'bramblewild', useTick: () => mock.clock.tick }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({}) }));
vi.mock('../bosses/DangerTiles', () => ({ default: () => null }));
vi.mock('../bosses/BulletLayer', () => ({ default: (props: any) => { mock.bullets.push(props); return null; } }));
vi.mock('../audio', () => ({ audio: { play: (name: string, opts: any) => { mock.play.push([name, opts]); return true; } } }));

import { ClatterhornModel, clatterBarText, clatterMenuOption, DASH_MS } from '../bosses/clatterhorn/Clatterhorn';
import { clatterMaterials, clatterTriangles } from '../bosses/clatterhorn/clatterGeometry';
import { clatterRowCues, startClatterFx, useClatterFxStore, CLATTER_LINES } from '../bosses/clatterhorn/clatterFx';
import { setClatterPlayerSource } from '../bosses/clatterhorn/clatterPlayers';
import { registerAvatarGroup, unregisterAvatarGroup } from '../animation/avatarRegistry';
import { mushroomRing, struckStone } from '../bosses/clatterhorn/ClatterGlade';
import { holdState } from '../Components/3D/tapAssist';
import { useBossStore } from '../bosses/bossStore';
import { useCombatFxStore } from '../spacetime/stores/combatFxStore';
import { useGiantStore } from '../spacetime/stores/giantStore';
import { useSettingsStore } from '../spacetime/stores/settingsStore';
import { useToastStore } from '../spacetime/stores/toastStore';
import { useUserInputStore } from '../store';

function row(patch: object = {}): any {
  return {
    id: 1, x: 84, z: 106, hp: 812, maxHp: 1250, state: ClatterState.Idle, phase: 1, stateUntilTick: 0, attack: 0, dir: 6,
    endX: 84, endZ: 106, endKind: 0, chain: 0, attackCount: 0, bait: 0, swarmTick: 0, swarmSide: 0, swarmFree: 0,
    engagedTick: 90, lastHitTick: 90, challengers: 7, fightCount: 3, defeats: 0, owedLeft: 0, ...patch,
  };
}

function setup(r: any, onAttack = vi.fn()) {
  const ui = render(<ClatterhornModel row={r} tick={mock.clock.tick} onAttack={onAttack} />);
  const dress = () => {
    for (const el of ui.container.querySelectorAll('group, mesh')) {
      if (!(el as any).position) Object.assign(el, { position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1) });
    }
  };
  dress();
  const frame = (now: number) => act(() => { mock.now = now; dress(); for (const f of mock.frames) f({ clock: { elapsedTime: now / 1000 } }, 1 / 60); });
  const el = (name: string) => ui.container.querySelector(`group[name="${name}"]`) as any;
  const click = (patch = {}) => {
    const g = el('clatterhorn');
    const props = g[Object.keys(g).find((k) => k.startsWith('__reactProps$'))!];
    act(() => props.onClick({ delta: 0, button: 0, stopPropagation: vi.fn(), clientX: 10, clientY: 10, ...patch }));
  };
  const rerender = (next: any) => { ui.rerender(<ClatterhornModel row={next} tick={mock.clock.tick} onAttack={onAttack} />); dress(); };
  return { ui, frame, el, click, rerender, onAttack };
}

beforeEach(() => {
  mock.now = 1000; mock.clock.tick = 101; mock.frames = []; mock.bullets = []; mock.play = [];
  vi.spyOn(performance, 'now').mockImplementation(() => mock.now);
  useSettingsStore.setState({ reduceMotion: true, oneClickAttack: false });
  useUserInputStore.getState().setClickedOtherObject(null);
  holdState.active = false; holdState.suppressClickUntil = 0;
  useClatterFxStore.setState({ seq: 0, hit: null, flinchAt: -Infinity, flipAt: -Infinity });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); useBossStore.getState().reset(); setClatterPlayerSource(null); });

describe('Clatterhorn model', () => {
  it('draws nothing while closed or missing', () => {
    expect(render(<ClatterhornModel row={null} tick={1} onAttack={() => {}} />).container.innerHTML).toBe('');
    expect(render(<ClatterhornModel row={row({ state: ClatterState.Closed })} tick={1} onAttack={() => {}} />).container.innerHTML).toBe('');
  });

  it('labels its HP, challengers, the flip window, sleep and the burrow countdown', () => {
    expect(clatterBarText(row(), 101)).toBe('Clatterhorn · 812/1,250 · 7 challengers');
    expect(clatterBarText(row({ challengers: 1 }), 101)).toBe('Clatterhorn · 812/1,250 · 1 challenger');
    expect(clatterBarText(row({ state: ClatterState.Burrowed, stateUntilTick: 351 }), 101)).toBe('Clatterhorn has burrowed · back in 2:30');
    expect(clatterBarText(row({ state: ClatterState.Dormant }), 101)).toBe('Clatterhorn sleeps in its glade');
    setup(row({ state: ClatterState.Flipped, stateUntilTick: 108 }));
    expect(screen.getByTestId('clatter-x2')).toHaveTextContent('x2');
    expect(screen.getByRole('meter', { name: 'Clatterhorn' })).toHaveAttribute('aria-valuenow', '812');
  });

  it('follows the Giant click sequence: drag and hold are ignored, one-click attacks, otherwise a menu', () => {
    const h = setup(row());
    h.click({ delta: 6 });
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
    holdState.active = true;
    h.click();
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
    holdState.active = false;
    h.click();
    const menu = useUserInputStore.getState().clickedOtherObject;
    expect(menu.dropdownOptions).toEqual([expect.objectContaining({ label: 'Attack Clatterhorn', disabled: false })]);
    act(() => menu.dropdownOptions[0].onClick());
    expect(h.onAttack).toHaveBeenCalledTimes(1);
    act(() => useSettingsStore.setState({ oneClickAttack: true }));
    h.click();
    expect(h.onAttack).toHaveBeenCalledTimes(2);
    // A held press still opens the options.
    h.click({ interaction: 'menu' });
    expect(useUserInputStore.getState().clickedOtherObject?.dropdownOptions[0].label).toBe('Attack Clatterhorn');
  });

  it('offers only a disabled option while burrowed, even with one-click attacks', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const h = setup(row({ state: ClatterState.Burrowed, stateUntilTick: 300 }));
    h.click();
    const menu = useUserInputStore.getState().clickedOtherObject;
    expect(menu.dropdownOptions[0]).toMatchObject({ label: 'Clatterhorn has burrowed away', disabled: true });
    act(() => menu.dropdownOptions[0].onClick());
    expect(h.onAttack).not.toHaveBeenCalled();
    expect(clatterMenuOption(ClatterState.Dormant).disabled).toBe(false);
  });

  it('dashes to the new centre on the avatar timeline when a charge lands', () => {
    const start = row({ state: ClatterState.ChargeWindup, attack: 1, x: 84, z: 106, dir: 6, endX: 88, endZ: 106, stateUntilTick: 101 });
    const h = setup(start);
    h.frame(1000);
    const [sx, , sz] = tileToWorld(start);
    const [ex] = tileToWorld({ x: 88, z: 106 });
    expect(h.el('clatterhorn').position.x).toBeCloseTo(sx);
    h.rerender({ ...start, state: ClatterState.Recover, x: 88, stateUntilTick: 103 });
    // The landing row arrived at 1000; the avatars catch up a tick later, so the dash ends at 1600.
    h.frame(1000 + mock.clock.period - DASH_MS - 1);
    expect(h.el('clatterhorn').position.x).toBeCloseTo(sx);
    h.frame(1000 + mock.clock.period - DASH_MS / 2);
    const mid = h.el('clatterhorn').position.x;
    expect(mid).toBeGreaterThan(sx);
    expect(mid).toBeLessThan(ex);
    h.frame(1000 + mock.clock.period + 10);
    expect(h.el('clatterhorn').position.x).toBeCloseTo(ex);
    expect(h.el('clatterhorn').position.z).toBeCloseTo(sz);
  });

  it('rolls onto its back with a glowing belly once a flip lands', () => {
    const h = setup(row({ state: ClatterState.Recover, stateUntilTick: 103 }));
    h.rerender(row({ state: ClatterState.Flipped, stateUntilTick: 109 }));
    for (let t = 1000; t <= 1600; t += 50) h.frame(t);
    expect(h.el('clatter-flip').rotation.z).toBeCloseTo(Math.PI);
    expect(clatterMaterials().belly.emissiveIntensity).toBeGreaterThan(0.5);
    h.rerender(row({ state: ClatterState.Recover, stateUntilTick: 111 }));
    for (let t = 1600; t <= 3000; t += 50) h.frame(t);
    expect(h.el('clatter-flip').rotation.z).toBeCloseTo(0);
    expect(clatterMaterials().belly.emissiveIntensity).toBe(0);
  });

  it('draws the swarm\'s runners through the shared bullet layer, only while it drums', () => {
    setup(row());
    expect(mock.bullets).toHaveLength(0);
    const drum = row({ state: ClatterState.Drumming, swarmTick: 100, stateUntilTick: 120, swarmSide: 2, swarmFree: 1 });
    setup(drum);
    const layer = mock.bullets[mock.bullets.length - 1];
    expect(layer.palette).toBe('runner');
    const src = layer.source();
    expect([...src.bullets]).toEqual([...clatterSwarmBullets(drum)]);
    expect(src).toMatchObject({ boxX0: 75, boxZ0: 97, boxX1: 93, boxZ1: 115 });
  });

  it('floats your blow over it, gold while it lies flipped', () => {
    setup(row({ state: ClatterState.Flipped, stateUntilTick: 108 }));
    act(() => useClatterFxStore.setState({ seq: 1, hit: { seq: 1, damage: 12, flipped: true, itemId: 'stone_club', at: 1000, delayMs: 0 } }));
    expect(screen.getByTestId('clatter-damage')).toHaveClass('clatter-crit');
    expect(screen.getByTestId('clatter-damage')).toHaveTextContent('12!');
    act(() => useClatterFxStore.setState({ seq: 2, hit: { seq: 2, damage: 6, flipped: false, itemId: 'stone_club', at: 1000, delayMs: 0 } }));
    expect(screen.getByTestId('clatter-damage')).not.toHaveClass('clatter-crit');
  });

  it('stays near its triangle budget', () => {
    const tris = clatterTriangles();
    expect(tris).toBeGreaterThan(800);
    expect(tris).toBeLessThan(1400);
  });
});

describe('Clatterhorn glade', () => {
  it('rings the glade with mushrooms just outside its tiles and finds the stone a flip hit', () => {
    const ring = mushroomRing();
    expect(ring.length).toBeGreaterThan(30);
    expect(mushroomRing()).toEqual(ring);
    expect(struckStone({ state: ClatterState.Flipped, x: 88, z: 103, dir: 6 })).toBe(1); // (90,103)
    expect(struckStone({ state: ClatterState.Recover, x: 88, z: 103, dir: 6 })).toBe(-1);
  });
});

describe('Clatterhorn FX', () => {
  const hex = (n: string) => n.padEnd(64, '0');
  const id = (h: string) => ({ toHexString: () => h });
  const notice = (kind: number, patch: object = {}) => ({ tick: 101, boss: BossId.Clatterhorn, kind, player: id(hex('me')), runId: 0n, amount: 0, total: 0, hp: 0, half: 0, quantity: 0, itemId: '', x: 0, z: 0, ...patch }) as any;

  it('reads landings, flips, spins, drums and windups from row changes', () => {
    const w = row({ state: ClatterState.ChargeWindup, stateUntilTick: 104 });
    expect(clatterRowCues(row(), w)).toEqual(['warn']);
    expect(clatterRowCues(w, { ...w, hp: 700 })).toEqual([]);
    expect(clatterRowCues(w, { ...w, x: 88, state: ClatterState.Flipped })).toEqual(['land', 'flip']);
    expect(clatterRowCues(w, { ...w, x: 88, state: ClatterState.ChargeWindup, stateUntilTick: 107 })).toEqual(['land', 'warn']);
    expect(clatterRowCues(row({ state: ClatterState.SpinWindup }), row({ state: ClatterState.Recover }))).toEqual(['spin']);
    expect(clatterRowCues(row({ state: ClatterState.DrumWindup, stateUntilTick: 104 }), row({ state: ClatterState.Drumming, swarmTick: 104 }))).toEqual(['drum']);
  });

  it('turns notices, events and swing cues into numbers, lines, toasts and swings', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const store = useBossStore.getState();
      store.setMe(hex('me'));
      store.setRow('clatterhorn', row({ state: ClatterState.Flipped, stateUntilTick: 108 }));
      setClatterPlayerSource({ weaponOf: () => 'stone_club', hexes: () => [] });
      const stop = startClatterFx();
      try {
        // Your blow while it lies flipped: a gold number.
        act(() => store.pushNotice(notice(BossNoticeKind.YouHit, { amount: 12, total: 40 })));
        expect(useClatterFxStore.getState().hit).toMatchObject({ damage: 12, flipped: true, itemId: 'stone_club' });
        expect(mock.play.some(([n]) => n === 'club')).toBe(true);
        // A blow on you floats a number over your avatar.
        act(() => store.pushNotice(notice(BossNoticeKind.Hurt, { amount: 10, half: 2, quantity: HurtSource.Charge })));
        expect(useCombatFxStore.getState().numbers[hex('me')]).toMatchObject({ text: '10' });
        // The defeat line, then one toast for the batched reward.
        act(() => store.pushEvent({ tick: 101, boss: BossId.Clatterhorn, kind: BossEventKind.ClatterDefeat, runId: 0n, player: id(hex('0')), x: 84, z: 106, quantity: 3, value: 0, text: '' } as any));
        expect(useGiantStore.getState().systemLines.at(-1)?.text).toBe(CLATTER_LINES.defeat(3));
        act(() => {
          store.pushNotice(notice(BossNoticeKind.Reward, { itemId: 'gleamshell', quantity: 2 }));
          store.pushNotice(notice(BossNoticeKind.Reward, { itemId: 'berry_goldberry', quantity: 2 }));
          store.pushNotice(notice(BossNoticeKind.Keepsake, { quantity: 12 }));
        });
        act(() => { vi.advanceTimersByTime(200); });
        expect(useToastStore.getState().message).toBe('Clatterhorn is beaten! You earned 2 gleamshell, 2 goldberry and the Clatterhorn keepsake');
        // Another player's swing: their avatar swings (negative cue seq, as for the Giant), with a whoosh at it.
        const ada = new Object3D(); ada.position.set(40, 0, 52);
        registerAvatarGroup(hex('ada'), ada);
        mock.play.length = 0;
        act(() => store.pushSwingCue(hex('ada'), 101));
        const cue = useCombatFxStore.getState().cues[hex('ada')];
        expect(cue.role).toBe('action');
        expect(cue.seq).toBeLessThan(0);
        act(() => { vi.advanceTimersByTime(2000); });
        expect(mock.play.find(([n]) => n === 'whoosh')?.[1]).toMatchObject({ x: 40, z: 52 });
        unregisterAvatarGroup(hex('ada'), ada);
        // A swinger with no rendered avatar (you are in the Spire, say) makes no sound at all.
        mock.play.length = 0;
        act(() => store.pushSwingCue(hex('bo'), 102));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(mock.play).toEqual([]);
        // Notices about another boss are ignored.
        const before = useClatterFxStore.getState().hit;
        act(() => store.pushNotice(notice(BossNoticeKind.YouHit, { boss: BossId.Spire, amount: 99 })));
        expect(useClatterFxStore.getState().hit).toBe(before);
      } finally {
        stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
