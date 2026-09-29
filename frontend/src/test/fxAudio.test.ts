import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AudioEngine, MAX_DISTANCE, MAX_VOICES, REF_DISTANCE, attenuation, busLevels } from '../audio/engine';
import { AMBIENT, SFX, VARIANTS, renderAmbient, renderSound } from '../audio/synth';
import { FxQueue } from '../fx/fxQueue';
import { DustPool } from '../fx/dustPool';
import { FLASH_TOTAL_MS, FLASH_WHITE_MS, clearFlashes, flashAt, flashMaterial, flashStage, flashVariantCount } from '../fx/hitFlash';
import { estimatedTick, harvestProgress } from '../fx/harvestProgress';
import { MeshStandardMaterial } from 'three';

/** A minimal AudioContext double that records what was scheduled. */
class FakeParam { value = 1; targets: number[] = []; setTargetAtTime(v: number) { this.targets.push(v); this.value = v; } }
class FakeNode { connected: unknown[] = []; connect(n: unknown) { this.connected.push(n); return n; } }
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeSource extends FakeNode {
  buffer: unknown = null; loop = false; playbackRate = new FakeParam(); onended: (() => void) | null = null; startedAt = -1;
  constructor(private readonly ctx: FakeContext) { super(); }
  start(when: number) { this.startedAt = when; this.ctx.started.push(this); }
}
class FakeContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 10;
  sampleRate = 8000;
  destination = {};
  started: FakeSource[] = [];
  gains: FakeGain[] = [];
  createGain() { const g = new FakeGain(); this.gains.push(g); return g; }
  createBufferSource() { return new FakeSource(this); }
  createBuffer(_c: number, length: number, sampleRate: number) { const data = new Float32Array(length); return { length, sampleRate, getChannelData: () => data }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

function engine() {
  let now = 1000;
  const ctx = new FakeContext();
  const e = new AudioEngine(() => ctx as unknown as AudioContext, () => now);
  return { e, ctx, advance: (ms: number) => { now += ms; } };
}

describe('audio engine', () => {
  it('is silent and allocates nothing before the first gesture', () => {
    const { e, ctx } = engine();
    expect(e.play('punch')).toBe(false);
    expect(ctx.started).toHaveLength(0);
    expect(e.ctx).toBeNull();
  });

  it('unlock resumes the context, renders every variant and starts both ambient loops', async () => {
    const { e, ctx } = engine();
    e.unlock();
    await Promise.resolve();
    expect(ctx.state).toBe('running');
    const loops = ctx.started.filter((s) => s.loop);
    expect(loops).toHaveLength(AMBIENT.length);
    e.unlock(); // idempotent: no second set of loops
    expect(ctx.started.filter((s) => s.loop)).toHaveLength(AMBIENT.length);
  });

  it('schedules a delayed one-shot at the impact time on the context clock', async () => {
    const { e, ctx } = engine();
    e.unlock(); await Promise.resolve();
    expect(e.play('stick', { delayMs: 520 })).toBe(true);
    const shot = ctx.started.at(-1)!;
    expect(shot.startedAt).toBeCloseTo(10.52);
    expect(shot.loop).toBe(false);
  });

  it('attenuates by distance to the listener and drops inaudible sounds', async () => {
    const { e, ctx } = engine();
    e.unlock(); await Promise.resolve();
    e.setListener(5, 5);
    expect(e.levelFor(1, 6, 5)).toBe(1);
    expect(e.levelFor(1, 5 + REF_DISTANCE * 2, 5)).toBeCloseTo(0.5);
    expect(e.levelFor(1, 5 + MAX_DISTANCE + 1, 5)).toBe(0);
    const before = ctx.started.length;
    expect(e.play('footstep', { x: 100, z: 100 })).toBe(false);
    expect(ctx.started.length).toBe(before);
  });

  it('attenuation falls monotonically to zero', () => {
    let last = 1;
    for (let d = 0; d <= MAX_DISTANCE + 2; d += 0.5) {
      const a = attenuation(d);
      expect(a).toBeLessThanOrEqual(last + 1e-9);
      last = a;
    }
    expect(attenuation(MAX_DISTANCE)).toBe(0);
  });

  it('throttles a sound restarted too soon and round-robins variants', async () => {
    const { e, ctx, advance } = engine();
    e.unlock(); await Promise.resolve();
    expect(e.play('footstep')).toBe(true);
    expect(e.play('footstep')).toBe(false);
    advance(50);
    expect(e.play('footstep')).toBe(true);
    const [a, b] = ctx.started.slice(-2);
    expect(a.buffer).not.toBe(b.buffer);
  });

  it('caps concurrent voices and frees them when they end', async () => {
    const { e, ctx } = engine();
    e.unlock(); await Promise.resolve();
    for (let i = 0; i < MAX_VOICES + 5; i++) e.play('punch');
    expect(e.active).toBe(MAX_VOICES);
    expect(e.play('club')).toBe(false);
    ctx.started.at(-1)!.onended!();
    expect(e.play('club')).toBe(true);
  });

  it('maps settings to bus gains, muting through master', async () => {
    expect(busLevels({ masterVolume: 0.5, sfxVolume: 2, ambientVolume: -1, muted: false })).toEqual({ master: 0.5, sfx: 1, ambient: 0 });
    expect(busLevels({ masterVolume: 0.5, sfxVolume: 1, ambientVolume: 1, muted: true }).master).toBe(0);
    const { e, ctx } = engine();
    e.unlock(); await Promise.resolve();
    e.setVolumes({ masterVolume: 0.3, sfxVolume: 0.5, ambientVolume: 0.2, muted: false });
    const [master, sfx, ambient] = ctx.gains;
    expect([master.gain.value, sfx.gain.value, ambient.gain.value]).toEqual([0.3, 0.5, 0.2]);
    e.setVolumes({ masterVolume: 0.3, sfxVolume: 0.5, ambientVolume: 0.2, muted: true });
    expect(master.gain.value).toBe(0);
    expect(e.play('click')).toBe(false);
  });
});

describe('synth', () => {
  it('renders every sound bounded, non-silent and deterministic', () => {
    for (const name of SFX) for (let v = 0; v < VARIANTS[name]; v++) {
      const a = renderSound(name, 8000, v);
      let peak = 0;
      for (const s of a) { expect(Number.isFinite(s)).toBe(true); peak = Math.max(peak, Math.abs(s)); }
      expect(peak).toBeGreaterThan(0.1);
      expect(peak).toBeLessThanOrEqual(1);
      expect(renderSound(name, 8000, v)).toEqual(a);
    }
  });
  it('ambient loops wrap without a jump', () => {
    for (const name of AMBIENT) {
      const a = renderAmbient(name, 22050);
      let step = 0;
      for (let i = 1; i < a.length; i++) step = Math.max(step, Math.abs(a[i] - a[i - 1]));
      // The wrap is no bigger a jump than the loop's own sample-to-sample motion.
      expect(Math.abs(a[0] - a[a.length - 1])).toBeLessThanOrEqual(step);
    }
  });
});

describe('fx queue', () => {
  it('fires entries on the frame they come due, in a fixed pool', () => {
    const q = new FxQueue(4);
    const fired: string[] = [];
    q.push(100, 1, 'b', 'a', 0);
    q.push(50, 1, 'c', 'a', 1);
    q.drain(60, (e) => fired.push(e.target));
    expect(fired).toEqual(['c']);
    q.drain(100, (e) => fired.push(e.target));
    expect(fired).toEqual(['c', 'b']);
    expect(q.size).toBe(0);
  });
  it('when full, overwrites the soonest-due entry and never grows', () => {
    const q = new FxQueue(2);
    const entries = q.entries;
    q.push(10, 1, 'x', '', 0); q.push(20, 1, 'y', '', 0); q.push(30, 1, 'z', '', 0);
    expect(q.entries).toBe(entries);
    expect(q.size).toBe(2);
    const fired: string[] = [];
    q.drain(1e9, (e) => fired.push(e.target));
    expect(fired.sort()).toEqual(['y', 'z']);
  });
});

describe('dust pool', () => {
  it('bursts, falls, fades and recycles within its capacity', () => {
    let seed = 1;
    const pool = new DustPool(16, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    const m = new Float32Array(16 * 16), c = new Float32Array(16 * 3);
    pool.burst(0, 1, 0, 1, 0, 2);
    expect(pool.write(m, c)).toBe(15);
    pool.burst(0, 1, 0, 1, 0, 2); // more than fits: ring reuse
    expect(pool.write(m, c)).toBe(16);
    pool.step(0.1);
    expect(pool.write(m, c)).toBe(16);
    expect(m[13]).toBeGreaterThanOrEqual(0.03); // y stays above ground
    // Mostly pushed along +x (away from the attacker).
    let sumX = 0; for (let i = 0; i < 16; i++) sumX += m[i * 16 + 12];
    expect(sumX).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) pool.step(0.05);
    expect(pool.write(m, c)).toBe(0);
  });
});

describe('hit flash', () => {
  beforeEach(clearFlashes);
  it('goes white, then red, then clears', () => {
    flashAt('a', 1000);
    expect(flashStage('a', 999)).toBe(0);
    expect(flashStage('a', 1000)).toBe(1);
    expect(flashStage('a', 1000 + FLASH_WHITE_MS)).toBe(2);
    expect(flashStage('a', 1000 + FLASH_TOTAL_MS)).toBe(0);
    expect(flashStage('b', 1000)).toBe(0);
  });
  it('shares two variants per palette material and frees them with it', () => {
    const base = new MeshStandardMaterial();
    const count = flashVariantCount();
    expect(flashMaterial(base, 0)).toBe(base);
    const white = flashMaterial(base, 1), red = flashMaterial(base, 2);
    expect(white).not.toBe(base);
    expect(flashMaterial(base, 1)).toBe(white);
    expect(red.emissive.r).toBeGreaterThan(red.emissive.g);
    expect(base.emissive.getHex()).toBe(0); // the shared palette material is untouched
    expect(flashVariantCount()).toBe(count + 1);
    base.dispose();
    expect(flashVariantCount()).toBe(count);
  });
});

describe('harvest progress', () => {
  it('interpolates between ticks and clamps', () => {
    const clock = { tick: 100, arrivedAt: 1000, period: 600 };
    expect(estimatedTick(1300, clock)).toBeCloseTo(100.5);
    expect(estimatedTick(9999, clock)).toBe(101);
    expect(harvestProgress(105, 10, 100)).toBeCloseTo(0.5);
    expect(harvestProgress(105, 10, 90)).toBe(0);
    expect(harvestProgress(105, 10, 200)).toBe(1);
    expect(harvestProgress(0, 10, 100)).toBe(0);
  });
});

vi.mock('../animation/avatarRegistry', () => ({ locateAvatar: () => ({ x: 0, z: 0 }) }));
