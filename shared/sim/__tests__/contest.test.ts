import { describe, expect, it, vi } from 'vitest';
import { CLAIM_ENERGY_BONUS, claimWeight, drawClaimant } from '../contest';
import { PlayerState } from '../types';

const vet = (id: string) => ({ id, state: PlayerState.Alive, respawnTick: 0 });
const fresh = (id: string) => ({ id, state: PlayerState.Alive, respawnTick: 500 });

describe('drawClaimant', () => {
  it('returns nothing for nobody and the only contender without a roll', () => {
    const random = vi.fn(() => 0.5);
    expect(drawClaimant([], 10, random)).toBeUndefined();
    expect(drawClaimant([vet('a')], 10, random)?.id).toBe('a');
    expect(random).not.toHaveBeenCalled();
  });

  it('maps the roll uniformly onto the contenders', () => {
    const all = [vet('a'), vet('b'), vet('c'), vet('d')];
    expect([0, 0.25, 0.5, 0.75, 0.999999].map((r) => drawClaimant(all, 10, () => r)?.id)).toEqual(['a', 'b', 'c', 'd', 'd']);
  });

  it('newcomers are drawn first; a lone newcomer needs no roll', () => {
    const random = vi.fn(() => 0.99);
    expect(drawClaimant([vet('a'), fresh('n'), vet('b')], 10, random)?.id).toBe('n');
    expect(random).not.toHaveBeenCalled();
    expect(drawClaimant([fresh('m'), vet('a'), fresh('n')], 10, () => 0)?.id).toBe('m');
  });

  it('is fair over many draws', () => {
    let seed = 7;
    const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const wins = new Map<string, number>();
    const all = ['a', 'b', 'c', 'd', 'e'].map(vet);
    for (let i = 0; i < 10_000; i++) {
      const id = drawClaimant(all, 10, lcg)!.id;
      wins.set(id, (wins.get(id) ?? 0) + 1);
    }
    for (const n of wins.values()) expect(n).toBeGreaterThan(1800);
  });

  it('weights the draw by energy: empty 1, rested line 3, full 4', () => {
    expect([0, 2400, 4800, 7200].map((p) => claimWeight(p, 7200))).toEqual([1, 2, 3, 1 + CLAIM_ENERGY_BONUS]);
    expect(claimWeight(9000, 7200)).toBe(4);
    const pts: Record<string, number> = { a: 0, b: 7200 };
    const weight = (c: { id: string }) => claimWeight(pts[c.id], 7200);
    // Total 5: a owns [0, 1), b owns [1, 5).
    expect(drawClaimant([vet('a'), vet('b')], 10, () => 0.19, weight)?.id).toBe('a');
    expect(drawClaimant([vet('a'), vet('b')], 10, () => 0.21, weight)?.id).toBe('b');
  });

  it('a weighted draw still gives every contender its share', () => {
    let seed = 11;
    const lcg = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pts: Record<string, number> = { tired: 0, normal: 4800, rested: 7200 };
    const all = Object.keys(pts).map(vet);
    const wins: Record<string, number> = { tired: 0, normal: 0, rested: 0 };
    for (let i = 0; i < 8000; i++) wins[drawClaimant(all, 10, lcg, (c) => claimWeight(pts[c.id], 7200))!.id]++;
    // Expected 1/8, 3/8, 4/8.
    expect(wins.tired).toBeGreaterThan(800); expect(wins.tired).toBeLessThan(1200);
    expect(wins.normal).toBeGreaterThan(2700); expect(wins.normal).toBeLessThan(3300);
    expect(wins.rested).toBeGreaterThan(3700); expect(wins.rested).toBeLessThan(4300);
  });
});
