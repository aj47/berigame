import { describe, expect, it } from 'vitest';
import { CREATURE_HEIGHT, CREATURE_SPECIES, creatureHeight, creatureRig } from '../frontier/creatureArt';

const EXPECTED = ['burrowbun', 'reedhorn', 'glowmoth', 'shellback', 'bristleback', 'thistlefox', 'puddlefrog', 'bumblewisp', 'hootling', 'driftgull', 'emberling'];

describe('creature art', () => {
  it('builds a rig with real geometry and a label height for every species', () => {
    expect(CREATURE_SPECIES).toEqual(expect.arrayContaining(EXPECTED));
    for (const species of CREATURE_SPECIES) {
      const rig = creatureRig(species);
      const tris = rig.nodes.reduce((sum, n) => sum + (n.geo.body?.getAttribute('position').count ?? 0) + (n.geo.glow?.getAttribute('position').count ?? 0), 0);
      expect(tris, species).toBeGreaterThan(300);
      expect(CREATURE_HEIGHT[species], species).toBeGreaterThan(.4);
      expect(rig.nodes.some(n => n.name === rig.collar.node), species).toBe(true);
    }
  });

  it('keeps every node parented, and falls back to a tinted critter for unknown species', () => {
    for (const species of [...CREATURE_SPECIES, 'mystery']) {
      const rig = creatureRig(species, '#7799cc');
      const names = new Set(rig.nodes.map(n => n.name));
      for (const n of rig.nodes) if (n.name !== 'root') expect(names.has(n.parent!), `${species}:${n.name}`).toBe(true);
    }
    expect(creatureRig('mystery', '#7799cc')).toBe(creatureRig('mystery', '#7799cc'));
    expect(creatureHeight('mystery')).toBeGreaterThan(.4);
  });

  it('animates every species for a few seconds of idle and movement without errors', () => {
    for (const species of [...CREATURE_SPECIES, 'mystery']) {
      const rig = creatureRig(species);
      const touched = new Set<string>();
      let t = 0, cycle = 0, sp = 0;
      const api = {
        get t() { return t; }, dt: 1 / 60, ph: 1, get m() { return Math.min(1, sp / 1.2); }, get sp() { return sp; },
        step: (hz: number) => (cycle += hz / 60),
        rot: (n: string, ...v: number[]) => { touched.add(n); v.forEach(x => expect(Number.isFinite(x)).toBe(true)); },
        move: (n: string, ...v: number[]) => { touched.add(n); v.forEach(x => expect(Number.isFinite(x)).toBe(true)); },
        scale: (n: string, ...v: number[]) => { touched.add(n); v.forEach(x => expect(Number.isFinite(x)).toBe(true)); },
        blink: () => false,
      };
      for (let i = 0; i < 240; i++) { t = i / 60; sp = i > 120 ? 2.5 : 0; rig.animate(api); }
      const names = new Set(rig.nodes.map(n => n.name));
      for (const n of touched) expect(names.has(n), `${species} animates missing node ${n}`).toBe(true);
    }
  });
});
