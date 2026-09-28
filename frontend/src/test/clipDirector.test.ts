import { describe, expect, it } from 'vitest';
import {
  ClipDirector, DEFEAT_AFTER_HIT_S, DEFEAT_DELAY_CAP_MS, FADE, HIT_BEFORE_DEFEAT_MS, fadeSeconds,
  type DirectorInput, type DirectorOptions,
} from '../animation/clipDirector';
import type { AnimationCue, Clip } from '../animation/combatPresentation';
import { STICK_SWING_CLIP } from '../animation/stickSwing';
import { MOVEMENT_ANIMATION_GRACE_MS, runScale } from '../animation/locomotion';

const DURATIONS: Record<string, number> = { Idle: 2, Run: 0.667, Stop: 0.5, Strike: 0.5, [STICK_SWING_CLIP]: 0.62, Hit: 0.4, Defeat: 1.2 };
const director = (options: Partial<DirectorOptions> = {}) => new ClipDirector({
  has: (clip) => clip in DURATIONS, duration: (clip) => DURATIONS[clip] ?? 0, ...options,
});
const idle = (now: number, extra: Partial<DirectorInput> = {}): DirectorInput => ({ now, dead: false, cue: null, moving: false, speed: 0, holdMs: 0, ...extra });
const cue = (clip: Clip, seq: number, at: number, role: 'action' | 'reaction' = 'action', durationMs = DURATIONS[clip] * 1000): AnimationCue => ({ clip, seq, at, role, durationMs });
const weights = (d: ClipDirector) => Object.fromEntries(d.layers.slice(0, d.count).map((l) => [`${l.clip}${l.mirror ? '~' : ''}#${l.slot}`, +l.weight.toFixed(3)]));
const total = (d: ClipDirector) => d.layers.slice(0, d.count).reduce((sum, l) => sum + l.weight, 0);

/** Step a director at 60fps from `from` to `to` (ms), calling `input` for each frame. */
function run(d: ClipDirector, from: number, to: number, input: (now: number) => DirectorInput, each?: (now: number) => void) {
  for (let now = from; now <= to + 1e-9; now += 1000 / 60) { d.update(input(now)); each?.(now); }
}

describe('clip director', () => {
  it('starts at full weight when nothing has played yet (no bind-pose frame on spawn)', () => {
    const d = director();
    d.update(idle(0));
    expect(d.count).toBe(1);
    expect(d.layers[0]).toMatchObject({ clip: 'Idle', weight: 1, loop: true });
    expect(d.clip).toBe('Idle');
    expect(d.cueKey).toBeNull();
  });

  it('fades by transition: quick into combat, slower back to rest', () => {
    expect(fadeSeconds('Idle', 'Run')).toBe(FADE.start);
    expect(fadeSeconds('Run', 'Stop')).toBe(0.1);
    expect(fadeSeconds('Idle', 'Strike')).toBeGreaterThanOrEqual(0.06);
    expect(fadeSeconds('Idle', STICK_SWING_CLIP)).toBeLessThanOrEqual(0.08);
    expect(fadeSeconds('Idle', 'Hit')).toBe(0.04);
    expect(fadeSeconds('Hit', 'Defeat')).toBe(0.12);
    expect(fadeSeconds('Strike', 'Idle')).toBe(0.2);
    expect(fadeSeconds('Run', 'Idle')).toBe(0.18);
    const d = director();
    d.update(idle(0));
    d.update(idle(1000, { cue: cue('Hit', 1, 1000, 'reaction') }));
    d.update(idle(1020, { cue: cue('Hit', 1, 1000, 'reaction') }));
    expect(weights(d)).toEqual({ 'Idle#0': 0.5, 'Hit#0': 0.5 });
  });

  it('crossfades a repeated attack into a fresh copy of itself: the swing never loses weight', () => {
    for (const clip of [STICK_SWING_CLIP, 'Strike'] as Clip[]) {
      const d = director();
      const length = DURATIONS[clip] * 1000;
      const first = cue(clip, 1, 100), second = cue(clip, 2, 100 + length);
      let lowest = Infinity, both = false;
      run(d, 0, 150 + 2 * length, (now) => idle(now, { cue: now >= second.at ? second : first }), (now) => {
        expect(total(d)).toBeCloseTo(1, 9);
        // From the end of the first swing's own fade-in until the second swing ends.
        if (now >= 100 + FADE.attack * 1000 + 1 && now < 100 + 2 * length) lowest = Math.min(lowest, d.weightOf(clip));
        if (d.count === 2 && d.layers[0].clip === clip && d.layers[1].clip === clip) both = d.layers[0].slot !== d.layers[1].slot;
      });
      expect(lowest, clip).toBeGreaterThanOrEqual(0.99);
      expect(both, `${clip} blends two copies`).toBe(true);
      expect(d.cueKey).toBeNull();
    }
  });

  it('keeps the weights summing to exactly 1 through any sequence of transitions', () => {
    const d = director({ leadStance: () => 1, mirrorable: (clip) => clip !== 'Run', runStart: [0.2, 0.7] });
    let seed = 7;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    let state: DirectorInput = idle(0), seq = 0;
    for (let now = 0; now < 20000; now += 1000 / 60) {
      if (random() < 0.04) {
        const pick = random();
        if (pick < 0.3) state = { ...state, moving: !state.moving, speed: 3.33, holdMs: 0 };
        else if (pick < 0.7) state = { ...state, cue: cue(([ 'Strike', STICK_SWING_CLIP, 'Hit'] as Clip[])[Math.floor(random() * 3)], ++seq, now, 'action') };
        else if (pick < 0.8) state = { ...state, holdMs: 30 };
        else if (pick < 0.85) state = { ...state, dead: !state.dead };
      }
      d.update({ ...state, now });
      expect(total(d)).toBeCloseTo(1, 9);
      expect(d.count).toBeLessThanOrEqual(6);
    }
  });

  it('stays whole when transitions arrive faster than fades finish (more layers than the pool)', () => {
    const d = director();
    d.update(idle(0));
    const clips: Clip[] = ['Strike', 'Hit', STICK_SWING_CLIP];
    for (let i = 0; i < 20; i++) {
      d.update(idle(100 + i * 5, { cue: cue(clips[i % 3], i + 1, 100 + i * 5, clips[i % 3] === 'Hit' ? 'reaction' : 'action'), moving: i % 2 === 0, speed: 3.33 }));
      expect(total(d)).toBeCloseTo(1, 9);
      expect(d.count).toBeLessThanOrEqual(6);
    }
    // Every layer the director let go of was handed back to be stopped.
    run(d, 300, 1500, (now) => idle(now));
    expect(weights(d)).toEqual({ 'Idle#0': 1 });
  });

  it('lets a killing blow land: Hit at impact, Defeat 150ms later, continuing the recoil', () => {
    const d = director();
    d.update(idle(0));
    // The swing's event and the defender's death arrive together; the Hit starts at impact, 300ms later.
    const hit = cue('Hit', 1, 1300, 'reaction');
    const seen: [number, Clip][] = [];
    run(d, 1000, 2000, (now) => idle(now, { dead: true, cue: hit }), (now) => { if (seen.at(-1)?.[1] !== d.clip) seen.push([Math.round(now), d.clip]); });
    expect(seen[0][1]).toBe('Idle');
    const hitAt = seen.find(([, c]) => c === 'Hit')![0], defeatAt = seen.find(([, c]) => c === 'Defeat')![0];
    expect(hitAt).toBeGreaterThanOrEqual(1300);
    expect(hitAt).toBeLessThan(1317);
    expect(defeatAt - 1300).toBeGreaterThanOrEqual(HIT_BEFORE_DEFEAT_MS);
    expect(defeatAt - 1300).toBeLessThan(HIT_BEFORE_DEFEAT_MS + 17);
    const defeat = d.layers.find((l) => l.clip === 'Defeat')!;
    expect(defeat.weight).toBe(1);
    // It started part way in, where the fall is under way.
    expect(DEFEAT_AFTER_HIT_S).toBeGreaterThan(0);
  });

  it('never keeps a dead avatar standing longer than the cap', () => {
    const d = director();
    d.update(idle(0));
    // A reaction scheduled far in the future (e.g. a very slow swing) must not delay the fall past the cap.
    const late = cue('Hit', 1, 5000, 'reaction');
    let defeatAt = -1;
    run(d, 1000, 3000, (now) => idle(now, { dead: true, cue: late }), (now) => { if (defeatAt < 0 && d.clip === 'Defeat') defeatAt = now; });
    expect(defeatAt - 1000).toBeGreaterThanOrEqual(DEFEAT_DELAY_CAP_MS - 17);
    expect(defeatAt - 1000).toBeLessThanOrEqual(DEFEAT_DELAY_CAP_MS + 17);
    // Without a pending reaction a death shows at once.
    const e = director();
    e.update(idle(0));
    e.update(idle(100, { dead: true }));
    expect(e.clip).toBe('Defeat');
  });

  it('winds Run down at the destination, settles through Stop, then Idle', () => {
    const d = director();
    d.update(idle(0));
    run(d, 16, 600, (now) => idle(now, { moving: true, speed: 3.33 }));
    expect(d.clip).toBe('Run');
    const layer = () => d.layers.find((l) => l.clip === 'Run')!;
    expect(layer().timeScale).toBeCloseTo(runScale(3.33));
    // Arrived: the body waits, the stride stops within a frame instead of running in place.
    d.update(idle(616, { moving: true, speed: 3.33, holdMs: 1 }));
    expect(layer().timeScale).toBeGreaterThan(0);
    d.update(idle(632, { moving: true, speed: 3.33, holdMs: 17 }));
    expect(layer().timeScale).toBe(0);
    // Travel resumes within the grace: cadence snaps back, no Stop.
    d.update(idle(648, { moving: true, speed: 3.33, holdMs: 0 }));
    expect(layer().timeScale).toBeCloseTo(runScale(3.33));
    expect(d.clip).toBe('Run');
    // A real stop.
    const stopAt = 700 + MOVEMENT_ANIMATION_GRACE_MS;
    d.update(idle(stopAt));
    expect(d.clip).toBe('Stop');
    run(d, stopAt + 16, stopAt + (DURATIONS.Stop - FADE.settle) * 1000 - 1, (now) => idle(now));
    expect(d.clip).toBe('Stop');
    run(d, stopAt + (DURATIONS.Stop - FADE.settle) * 1000, stopAt + 1000, (now) => idle(now));
    expect(d.clip).toBe('Idle');
    expect(weights(d)).toEqual({ 'Idle#0': 1 });
  });

  it('stands on the foot the stride left forward, and starts running from it', () => {
    let lead: 0 | 1 = 1;
    const d = director({ leadStance: () => lead, mirrorable: (clip) => clip !== 'Run', runStart: [0.2, 0.7] });
    d.update(idle(0));
    expect(d.layers[0].mirror).toBe(false);
    d.update(idle(16, { moving: true, speed: 3.33 }));
    const runLayer = d.layers.find((l) => l.clip === 'Run')!;
    expect(runLayer.start).toBeCloseTo(0.2 * DURATIONS.Run);
    run(d, 32, 500, (now) => idle(now, { moving: true, speed: 3.33 }));
    d.update(idle(520));
    expect(d.clip).toBe('Stop');
    expect(d.layers.find((l) => l.clip === 'Stop')!.mirror).toBe(true);
    run(d, 536, 2000, (now) => idle(now));
    expect(d.layers[0]).toMatchObject({ clip: 'Idle', mirror: true });
    // An attack from that stance keeps it; the next run starts from the left foot.
    d.update(idle(2100, { cue: cue('Strike', 1, 2100) }));
    expect(d.layers.find((l) => l.clip === 'Strike')!.mirror).toBe(true);
    lead = 0;
    d.update(idle(2700, { moving: true, speed: 3.33 }));
    expect(d.layers.find((l) => l.clip === 'Run')!.start).toBeCloseTo(0.7 * DURATIONS.Run);
  });

  it('falls back to the baked jab when a rig has no StickSwing', () => {
    const d = new ClipDirector({ has: (clip) => clip !== STICK_SWING_CLIP, duration: (clip) => DURATIONS[clip] ?? 0 });
    d.update(idle(0));
    d.update(idle(10, { cue: cue(STICK_SWING_CLIP, 1, 10) }));
    expect(d.clip).toBe('Strike');
    expect(d.cueKey).toBe('1:action');
  });

  it('reports clip and cue for the debug contract only when they change', () => {
    const d = director();
    d.update(idle(0));
    const r = d.revision;
    d.update(idle(16));
    expect(d.revision).toBe(r);
    d.update(idle(32, { cue: cue('Hit', 4, 32, 'reaction') }));
    expect(d.revision).toBe(r + 1);
    expect([d.clip, d.cueKey]).toEqual(['Hit', '4:reaction']);
  });

  it('plays a hit reaction queued behind the avatar\'s own swing once the swing ends', () => {
    const d = director();
    const swing = { ...cue(STICK_SWING_CLIP, 1, 1000), then: cue('Hit', 2, 1660, 'reaction') };
    d.update(idle(1000, { cue: swing }));
    d.update(idle(1600, { cue: swing }));
    expect([d.clip, d.cueKey]).toEqual([STICK_SWING_CLIP, '1:action']);
    d.update(idle(1670, { cue: swing }));
    expect([d.clip, d.cueKey]).toEqual(['Hit', '2:reaction']);
    d.update(idle(2100, { cue: swing }));
    expect(d.cueKey).toBeNull();
  });
});
