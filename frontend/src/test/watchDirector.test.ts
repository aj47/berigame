import { describe, expect, it } from 'vitest';
import { Director, type DirectedPlayer } from '../watch/director';

const player = (hex: string, hp = 30, over: Partial<DirectedPlayer> = {}): DirectedPlayer => ({ hex, hp, online: true, dead: false, target: null, ...over });
const HOLD = 8000;

describe('Director', () => {
  it('has nobody to show until a player is online', () => {
    const d = new Director();
    expect(d.step([], 0)).toBeNull();
    expect(d.step([player('a', 30, { online: false })], 1000)).toBeNull();
    expect(d.step([player('a')], 2000)).toBe('a');
  });

  it('cuts to a fight, but only after the hold', () => {
    const d = new Director({ holdMs: HOLD });
    const calm = [player('a'), player('b'), player('c')];
    expect(d.step(calm, 0)).toBe('a');
    const fight = [player('a'), player('b', 22, { target: 'c' }), player('c', 21, { target: 'b' })];
    expect(d.step(fight, 1000)).toBe('a');
    expect(d.step(fight, HOLD - 1)).toBe('a');
    expect(['b', 'c']).toContain(d.step(fight, HOLD + 1));
  });

  it('holds a live fight against a slightly hotter one', () => {
    const d = new Director({ holdMs: HOLD });
    let hpA = 30, hpB = 30, hpC = 30, hpD = 30;
    const round = () => [player('a', hpA, { target: 'b' }), player('b', hpB, { target: 'a' }), player('c', hpC, { target: 'd' }), player('d', hpD, { target: 'c' })];
    expect(d.step(round(), 0)).toBe('a');
    let shots = new Set<string | null>();
    for (let t = 1000; t < 60_000; t += 1000) {
      if (t % 2000 === 0) { hpA -= 1; hpB -= 1; hpC -= 1; hpD -= 1; }
      shots.add(d.step(round(), t));
    }
    expect(shots.size).toBe(1);
  });

  it('moves around the cast when nothing is happening', () => {
    const d = new Director({ holdMs: HOLD, idleMs: 20_000 });
    const calm = [player('a'), player('b')];
    const seen = new Set<string | null>();
    for (let t = 0; t < 90_000; t += 1000) seen.add(d.step(calm, t));
    expect(seen).toEqual(new Set(['a', 'b']));
  });

  it('never cuts to the dead, and leaves a player who logs off at once', () => {
    const d = new Director({ holdMs: HOLD });
    expect(d.step([player('a'), player('b')], 0)).toBe('a');
    expect(d.step([player('a', 30, { online: false }), player('b', 0, { dead: true }), player('c')], 1000)).toBe('c');
  });

  it('stays through a death in the shot until the hold ends', () => {
    const d = new Director({ holdMs: HOLD });
    expect(d.step([player('a')], 0)).toBe('a');
    expect(d.step([player('a', 0, { dead: true }), player('b')], 1000)).toBe('a');
  });
});
