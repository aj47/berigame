import { describe, expect, it } from 'vitest';
import { HOLD_RAMP_MS, START_EASE_MS, TURN_RATE, dampAngle, easedElapsed, easedSpeedFactor, holdCadence, turnFactor } from '../animation/locomotion';

describe('locomotion timing', () => {
  it('eases a start from rest in and is exactly on schedule after START_EASE_MS', () => {
    expect(easedElapsed(0)).toBe(0);
    expect(easedElapsed(START_EASE_MS)).toBe(START_EASE_MS);
    for (const t of [80, 81, 150, 300, 599.5, 1200]) expect(easedElapsed(t)).toBe(t);
    // Behind schedule early on, never ahead, and monotone.
    let previous = 0;
    for (let t = 1; t < START_EASE_MS; t++) {
      const eased = easedElapsed(t);
      expect(eased).toBeLessThan(t);
      expect(eased).toBeGreaterThan(previous);
      previous = eased;
    }
    expect(easedElapsed(START_EASE_MS / 4)).toBeLessThan(START_EASE_MS / 8);
    // Speed rises from rest, overshoots at most 4/3 to catch up, and ends at the scheduled speed.
    expect(easedSpeedFactor(0)).toBe(0);
    expect(easedSpeedFactor(START_EASE_MS)).toBe(1);
    for (let t = 0; t <= START_EASE_MS; t++) expect(easedSpeedFactor(t)).toBeLessThanOrEqual(4 / 3 + 1e-12);
    // A duration shorter than the ease still arrives on time.
    expect(easedElapsed(40, 40)).toBe(40);
    expect(easedElapsed(10, 0)).toBe(10);
  });

  it('turns with the same half-life at any frame rate (the old 0.2 per frame at 60 fps)', () => {
    expect(Math.abs(turnFactor(1 / 60) - 0.2)).toBeLessThan(0.01);
    const halfLife = (fps: number) => {
      let angle = 0, t = 0;
      while (Math.abs(1 - angle) > 0.5) { angle = dampAngle(angle, 1, turnFactor(1 / fps)); t += 1 / fps; }
      return t;
    };
    const exact = Math.LN2 / TURN_RATE;
    for (const fps of [30, 60, 120, 144]) expect(Math.abs(halfLife(fps) - exact)).toBeLessThanOrEqual(1 / fps);
    // Shortest way round.
    expect(dampAngle(3, -3, 1)).toBeCloseTo(-3 + 2 * Math.PI);
  });

  it('stops the stride within a frame of the body stopping', () => {
    expect(holdCadence(0)).toBe(1);
    expect(holdCadence(HOLD_RAMP_MS / 2)).toBeCloseTo(0.5);
    expect(holdCadence(HOLD_RAMP_MS)).toBe(0);
    expect(holdCadence(100)).toBe(0);
  });
});
