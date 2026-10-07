import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { Euler, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLATTER_GLADE, ClatterEndKind, ClatterState, GRID_SIZE, bulletDangerKeys, clatterLane, clatterSpinTiles, clatterSwarmBullets,
  clatterValidCentre, identityKey32, type ClatterRowLike,
} from '@sim';

const mock = vi.hoisted(() => ({ now: 1000, frames: [] as any[], tiles: [] as any[], clock: { tick: 101, period: 600, arrivedAt: 0 } }));
vi.mock('@react-three/fiber', () => ({ useFrame: (frame: any) => { mock.frames.push(frame); } }));
vi.mock('../spacetime/tickClock', () => ({ tickClock: mock.clock }));
vi.mock('../bosses/DangerTiles', () => ({ default: (props: any) => { mock.tiles.push(props); return null; } }));

import ClatterTelegraph, { TELEGRAPH_COLORS, spinEyeTiles, swarmFreeTiles } from '../bosses/clatterhorn/ClatterTelegraph';
import { setClatterPlayerSource } from '../bosses/clatterhorn/clatterPlayers';
import { registerAvatarGroup, unregisterAvatarGroup } from '../animation/avatarRegistry';
import { useSettingsStore } from '../spacetime/stores/settingsStore';

const G = CLATTER_GLADE;
const inGlade = (x: number, z: number) => x >= G.x0 && x <= G.x1 && z >= G.z0 && z <= G.z1;

function baseRow(patch: Partial<ClatterRowLike> = {}): any {
  return {
    id: 1, x: 84, z: 106, hp: 350, maxHp: 350, state: ClatterState.Idle, phase: 1, stateUntilTick: 0, attack: 0, dir: 0,
    endX: 84, endZ: 106, endKind: 0, chain: 0, attackCount: 0, bait: 0, swarmTick: 0, swarmSide: 0, swarmFree: 0,
    engagedTick: 90, lastHitTick: 90, challengers: 1, fightCount: 1, defeats: 0, owedLeft: 0, ...patch,
  };
}

/** A real lane from the glade with the wanted end kind (searched, so it follows the shared geometry). */
function laneWith(kind: number) {
  for (let z = G.z0 + 1; z < G.z1; z++) for (let x = G.x0 + 1; x < G.x1; x++) {
    if (!clatterValidCentre({ x, z })) continue;
    for (let dir = 0; dir < 8; dir++) {
      const lane = clatterLane({ x, z }, dir);
      if (lane.len >= 2 && lane.endKind === kind) return { x, z, lane };
    }
  }
  throw new Error(`no lane ends in kind ${kind}`);
}

function chargeRow(kind: number, patch: Partial<ClatterRowLike> = {}) {
  const { x, z, lane } = laneWith(kind);
  return baseRow({ state: ClatterState.ChargeWindup, attack: 1, x, z, dir: lane.dir, endX: lane.end.x, endZ: lane.end.z, endKind: lane.endKind, stateUntilTick: 103, ...patch });
}

function setup(row: any, tick = mock.clock.tick) {
  const ui = render(<ClatterTelegraph row={row} tick={tick} />);
  // The DOM harness holds R3F refs; give them transforms so the real frame callback can run.
  const dress = () => {
    for (const el of ui.container.querySelectorAll('group, mesh')) {
      if (!(el as any).position) Object.assign(el, { position: new Vector3(), rotation: new Euler(), scale: new Vector3(1, 1, 1) });
    }
  };
  dress();
  const frame = (now: number) => act(() => { mock.now = now; dress(); for (const f of mock.frames) f({ clock: { elapsedTime: now / 1000 } }, 1 / 60); });
  const el = (name: string) => ui.container.querySelector(`group[name="${name}"]`) as any;
  const rerender = (next: any, t = tick) => { mock.tiles = []; ui.rerender(<ClatterTelegraph row={next} tick={t} />); dress(); };
  return { ui, frame, el, rerender };
}

const lastTiles = (color: string) => [...mock.tiles].reverse().find((p) => p.color === color);

beforeEach(() => {
  mock.now = 1000; mock.clock.tick = 101; mock.frames = []; mock.tiles = [];
  vi.spyOn(performance, 'now').mockImplementation(() => mock.now);
  useSettingsStore.setState({ reduceMotion: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); setClatterPlayerSource(null); });

describe('Clatterhorn charge telegraph', () => {
  it('draws exactly the lane that resolves, filling from the windup start even when mounted late', () => {
    const row = chargeRow(ClatterEndKind.Skid);
    const h = setup(row);
    const lane = clatterLane(row, row.dir);
    const danger = lastTiles(TELEGRAPH_COLORS.danger);
    expect([...danger.tiles]).toEqual(lane.tiles);
    expect(danger.stripes).toBe(true);
    // Phase 1 leads by 4 ticks: windup started at 99, we joined at 101, so half of it has passed.
    h.frame(1000);
    expect(h.el('clatter-fill').visible).toBe(true);
    expect(h.el('clatter-fill').scale.z).toBeCloseTo(0.5);
    h.frame(1600);
    expect(h.el('clatter-fill').scale.z).toBeCloseTo(0.75);
  });

  it('keeps progress through unrelated row writes and restarts for a chained charge', () => {
    const row = chargeRow(ClatterEndKind.Skid);
    const h = setup(row);
    h.frame(1300);
    expect(h.el('clatter-fill').scale.z).toBeCloseTo(0.625);
    h.rerender({ ...row, hp: 300 });
    h.frame(1600);
    expect(h.el('clatter-fill').scale.z).toBeCloseTo(0.75);
    // A chained charge in phase 2 (lead 3) that began on tick 107; we see it at 108.
    mock.clock.tick = 108;
    h.rerender({ ...row, phase: 2, x: row.endX, z: row.endZ, stateUntilTick: 110 }, 108);
    h.frame(1600);
    expect(h.el('clatter-fill').scale.z).toBeCloseTo(1 / 3);
  });

  it.each([
    [ClatterEndKind.Flip, 'clatter-endcap-flip'],
    [ClatterEndKind.Glance, 'clatter-endcap-glance'],
    [ClatterEndKind.Skid, 'clatter-endcap-skid'],
  ])('marks the end of the lane with its end kind (%i)', (kind, name) => {
    const h = setup(chargeRow(kind));
    expect(h.el(name)).not.toBeNull();
    for (const other of ['clatter-endcap-flip', 'clatter-endcap-glance', 'clatter-endcap-skid'].filter((n) => n !== name)) expect(h.el(other)).toBeNull();
  });

  it('hangs a reticle over the bait, found by its identity key, and nobody else', () => {
    const bait = 'c0ffee'.padEnd(56, '0') + '1234abcd';
    const other = 'beef'.padEnd(56, '0') + '00000042';
    setClatterPlayerSource({ weaponOf: () => null, hexes: () => [other, bait] });
    const group = { position: { x: 12.5, z: 80 } } as any;
    registerAvatarGroup(bait, group);
    try {
      const row = chargeRow(ClatterEndKind.Skid, { bait: identityKey32(bait) });
      const h = setup(row);
      h.frame(1000);
      const reticle = h.el('clatter-bait');
      expect(reticle.visible).toBe(true);
      expect(reticle.position.x).toBeCloseTo(12.5);
      expect(reticle.position.z).toBeCloseTo(80);
      expect(reticle.position.y).toBeGreaterThan(2);
      h.rerender({ ...row, bait: identityKey32(other) + 1 });
      h.frame(1100);
      expect(h.el('clatter-bait').visible).toBe(false);
      // A spin has no bait to mark.
      h.rerender({ ...row, state: ClatterState.SpinWindup });
      h.frame(1200);
      expect(h.el('clatter-bait').visible).toBe(false);
    } finally {
      unregisterAvatarGroup(bait, group);
    }
  });
});

describe('Clatterhorn spin and swarm telegraphs', () => {
  it('rings the spin in red with the safe eye in green, back-dated over its 3-tick lead', () => {
    const row = baseRow({ state: ClatterState.SpinWindup, attack: 2, stateUntilTick: 102 });
    const h = setup(row);
    expect([...lastTiles(TELEGRAPH_COLORS.danger).tiles]).toEqual(clatterSpinTiles(row));
    const eye = lastTiles(TELEGRAPH_COLORS.safe);
    expect([...eye.tiles].sort((a, b) => a - b)).toEqual(spinEyeTiles(row).sort((a, b) => a - b));
    expect(eye.tiles).toHaveLength(9);
    // Started at 99, seen at 101: two of three ticks have passed.
    h.frame(1000);
    expect(h.el('clatter-fill').scale.x).toBeCloseTo(2 / 3);
    expect(h.el('clatter-endcap-skid')).toBeNull();
  });

  it('shows the free lines and the runners\' next two ticks of danger while the swarm runs', () => {
    const fire = 103;
    const row = baseRow({ state: ClatterState.DrumWindup, attack: 3, stateUntilTick: fire, swarmSide: 1, swarmFree: 2 });
    setup(row, fire);
    const bullets = clatterSwarmBullets(row);
    const next = bulletDangerKeys(bullets, fire + 1, inGlade);
    expect(next.size).toBeGreaterThan(0);
    expect([...lastTiles(TELEGRAPH_COLORS.runnerNext).tiles].sort()).toEqual([...next].sort());
    const free = lastTiles(TELEGRAPH_COLORS.free);
    expect([...free.tiles]).toEqual(swarmFreeTiles(row));
    // Free columns are never touched by a runner.
    const freeSet = new Set(free.tiles);
    for (let t = fire; t <= fire + 20; t++) for (const k of bulletDangerKeys(bullets, t, inGlade)) expect(freeSet.has(k)).toBe(false);
    // The drum's warning row is the first glade row the runners enter, in amber.
    for (const k of lastTiles(TELEGRAPH_COLORS.drum).tiles) expect(k % GRID_SIZE).toBe(G.x1);
  });

  it('draws nothing while it only idles', () => {
    const h = setup(baseRow());
    h.frame(1000);
    expect(mock.tiles).toHaveLength(0);
    expect(h.el('clatter-fill').visible).toBe(false);
    expect(h.el('clatter-bait').visible).toBe(false);
  });
});
