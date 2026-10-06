import { describe, expect, it } from 'vitest';
import { createStepSender, stepDelta, stepTarget, type StepKeys } from '../bosses/spire/stepInput';

const keys = (k: Partial<StepKeys>): StepKeys => ({ up: false, down: false, left: false, right: false, ...k });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};

describe('camera-relative step directions', () => {
  it('maps up/right at the 4 cardinal azimuths', () => {
    // Azimuth 0: the camera south of the arena looking north.
    expect(stepDelta(keys({ up: true }), 0)).toEqual([0, -1]);
    expect(stepDelta(keys({ right: true }), 0)).toEqual([1, 0]);
    // Camera east of the arena looking west: up walks west, right walks north.
    expect(stepDelta(keys({ up: true }), Math.PI / 2)).toEqual([-1, 0]);
    expect(stepDelta(keys({ right: true }), Math.PI / 2)).toEqual([0, -1]);
    // Camera north looking south.
    expect(stepDelta(keys({ up: true }), Math.PI)).toEqual([0, 1]);
    expect(stepDelta(keys({ left: true }), Math.PI)).toEqual([1, 0]);
    // Camera west looking east.
    expect(stepDelta(keys({ up: true }), -Math.PI / 2)).toEqual([1, 0]);
    expect(stepDelta(keys({ down: true }), 3 * Math.PI / 2)).toEqual([-1, 0]);
  });

  it('snaps the azimuth to 45-degree sectors and combines keys into diagonals', () => {
    expect(stepDelta(keys({ up: true }), 0.3)).toEqual([0, -1]);
    expect(stepDelta(keys({ up: true }), Math.PI / 4)).toEqual([-1, -1]);
    expect(stepDelta(keys({ up: true, right: true }), 0)).toEqual([1, -1]);
    expect(stepDelta(keys({ down: true, left: true }), Math.PI / 2)).toEqual([1, 1]);
    expect(stepDelta(keys({}), 0)).toBeNull();
    expect(stepDelta(keys({ up: true, down: true }), 0)).toBeNull();
  });
});

describe('step targets', () => {
  const me = { x: 74, z: 66 };
  it('a tap steps 1 tile, holding steps 2 per tick, Shift keeps 1', () => {
    expect(stepTarget(me, [1, 0], false, false)).toEqual({ x: 75, z: 66 });
    expect(stepTarget(me, [1, 0], true, false)).toEqual({ x: 76, z: 66 });
    expect(stepTarget(me, [1, -1], true, false)).toEqual({ x: 76, z: 64 });
    expect(stepTarget(me, [1, 0], true, true)).toEqual({ x: 75, z: 66 });
  });

  it('never targets off the floor or onto the dais', () => {
    expect(stepTarget({ x: 84, z: 60 }, [1, 0], false, false)).toEqual({ x: 84, z: 60 });
    expect(stepTarget({ x: 83, z: 60 }, [1, 0], true, false)).toEqual({ x: 84, z: 60 });
    // The dais is x 76..78, z 61..63.
    expect(stepTarget({ x: 74, z: 62 }, [1, 0], true, false)).toEqual({ x: 75, z: 62 });
    expect(stepTarget({ x: 75, z: 62 }, [1, 0], false, false)).toEqual({ x: 75, z: 62 });
  });
});

describe('the step sender', () => {
  it('keeps one setTarget in flight and lets the latest intent replace a queued one', async () => {
    const calls: [number, number][] = [];
    const pending: ReturnType<typeof deferred>[] = [];
    const sender = createStepSender((x, z) => { calls.push([x, z]); const d = deferred(); pending.push(d); return d.promise; });
    sender.send({ x: 1, z: 1 });
    expect(sender.inFlight).toBe(true);
    sender.send({ x: 2, z: 2 });
    sender.send({ x: 3, z: 3 });
    expect(calls).toEqual([[1, 1]]);
    expect(sender.queued).toEqual({ x: 3, z: 3 });
    pending[0].resolve();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(calls).toEqual([[1, 1], [3, 3]]);
    expect(sender.queued).toBeNull();
    pending[1].resolve();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(sender.inFlight).toBe(false);
    sender.send({ x: 4, z: 4 });
    expect(calls).toEqual([[1, 1], [3, 3], [4, 4]]);
  });

  it('a rejected call still frees the slot', async () => {
    const calls: number[] = [];
    let first = true;
    const sender = createStepSender((x) => { calls.push(x); if (first) { first = false; return Promise.reject(new Error('no')); } return Promise.resolve(); });
    sender.send({ x: 1, z: 0 });
    sender.send({ x: 2, z: 0 });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([1, 2]);
    expect(sender.inFlight).toBe(false);
  });
});
