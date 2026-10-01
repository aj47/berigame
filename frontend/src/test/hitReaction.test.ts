import { afterEach, describe, expect, it } from 'vitest';
import { HITSTOP_MS, KNOCKBACK, PUSH_MS, RETURN_MS, clearHitReactions, hitReactionPrefs, inHitstop, knockEnvelope, knockOffset, reactAt } from '../fx/hitReaction';

const out = { x: 0, z: 0 };
afterEach(() => { clearHitReactions(); hitReactionPrefs.reduced = false; });

describe('hit reactions', () => {
  it('pushes the victim away from the attacker and eases back to rest', () => {
    reactAt('v', 'a', 1000, 2, 3, 0);
    expect(knockOffset('v', 999, out)).toBe(true);
    expect(out.x).toBe(0);
    knockOffset('v', 1000 + PUSH_MS, out);
    expect(out.x).toBeCloseTo(KNOCKBACK[2]);
    expect(out.z).toBeCloseTo(0);
    knockOffset('v', 1000 + PUSH_MS + RETURN_MS / 2, out);
    expect(out.x).toBeGreaterThan(0);
    expect(out.x).toBeLessThan(KNOCKBACK[2]);
    expect(knockOffset('v', 1000 + PUSH_MS + RETURN_MS, out)).toBe(false);
    expect(out.x).toBe(0);
  });

  it('envelope is continuous and never overshoots', () => {
    let prev = 0;
    for (let t = 0; t <= PUSH_MS + RETURN_MS; t += 5) {
      const e = knockEnvelope(t);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
      expect(Math.abs(e - prev)).toBeLessThan(0.2);
      prev = e;
    }
  });

  it('freezes both fighters only on heavy blows, scaled by weapon', () => {
    reactAt('v', 'a', 0, 0, 1, 0);
    expect(inHitstop('a', 10)).toBe(false);
    reactAt('v', 'a', 0, 2, 1, 0);
    expect(inHitstop('a', 10)).toBe(true);
    expect(inHitstop('v', HITSTOP_MS[2] - 1)).toBe(true);
    expect(inHitstop('v', HITSTOP_MS[2] + 1)).toBe(false);
  });

  it('reduce motion disables both', () => {
    hitReactionPrefs.reduced = true;
    reactAt('v', 'a', 0, 2, 1, 0);
    expect(knockOffset('v', PUSH_MS, out)).toBe(false);
    expect(inHitstop('a', 10)).toBe(false);
  });
});
