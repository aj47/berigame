/**
 * Motion quality of the real adventurer rig driven by the game's animation
 * code, at a fixed 60 fps: the regressions the quality plan measured.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { avatarClipSet, type AvatarClipSet } from '../animation/stance';
import { STICK_SWING_CLIP } from '../animation/stickSwing';
import { HIT_BEFORE_DEFEAT_MS } from '../animation/clipDirector';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';
import { makeAvatar, play, playingWeight, type Timeline } from './animationTimeline';

let rig: AdventurerRig;
let set: AvatarClipSet;
beforeAll(async () => {
  rig = await loadAdventurerRig();
  set = avatarClipSet(rig.scene, rig.animations);
});

/** Ankle below this height (world units; the standing ankle is at 0.17) is on the ground. */
const CONTACT = 0.185;
/**
 * Horizontal travel of the ankles while on the ground. `flat` counts only
 * frames where the ankle is not also rising or landing (vertical speed under
 * 0.1 u/s): a planted foot sliding, not a foot stepping down into place.
 */
function footSlide(samples: { ms: number; feet: Vector3[] }[], from: number, to: number, flat: boolean) {
  let slide = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i], b = samples[i - 1];
    if (a.ms <= from || a.ms > to) continue;
    const dt = (a.ms - b.ms) / 1000;
    a.feet.forEach((foot, k) => {
      const before = b.feet[k];
      if (foot.y >= CONTACT || before.y >= CONTACT) return;
      if (flat && Math.abs(foot.y - before.y) / dt > 0.1) return;
      slide += Math.hypot(foot.x - before.x, foot.z - before.z);
    });
  }
  return slide;
}

describe('animation quality', () => {
  it('never lets a repeated attack fall back to the bind pose (weight stays >= 0.99)', () => {
    for (const [clip, length] of [[STICK_SWING_CLIP, 620], ['Strike', 500]] as const) {
      const avatar = makeAvatar(rig.scene, set, { seed: 1 });
      const timeline: Timeline = { endMs: 400 + 2 * length, cues: [
        { clip, durationMs: length, seq: 1, at: 200, role: 'action' },
        { clip, durationMs: length, seq: 2, at: 200 + length, role: 'action' },
      ] };
      let lowest = Infinity, twoCopies = false;
      play([avatar], timeline, 60, (ms) => {
        if (ms > 0) lowest = Math.min(lowest, playingWeight(avatar.animator));
        const d = avatar.animator.director;
        if (d.count === 2 && d.layers[0].clip === clip && d.layers[1].clip === clip) twoCopies = true;
      });
      expect(lowest, clip).toBeGreaterThanOrEqual(0.99);
      expect(twoCopies, `${clip} crossfades into a fresh copy`).toBe(true);
    }
  });

  it('starts at full weight on the first frame, and again if a disposed animator is stepped', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 2 });
    const weights: number[] = [];
    play([avatar], { endMs: 100 }, 60, () => weights.push(playingWeight(avatar.animator)));
    avatar.animator.dispose();
    play([avatar], { endMs: 100, cues: [{ clip: STICK_SWING_CLIP, durationMs: 620, seq: 1, at: 0, role: 'action' }] }, 60, () => weights.push(playingWeight(avatar.animator)));
    expect(Math.min(...weights)).toBeGreaterThanOrEqual(0.99);
    expect(avatar.animator.director.clip).toBe(STICK_SWING_CLIP);
  });

  it('stops without running in place: planted feet slide < 0.1 at arrival, from any stride phase', () => {
    const slides: number[] = [], strict: number[] = [];
    for (const tiles of [1, 2, 3, 4]) {
      const avatar = makeAvatar(rig.scene, set, { seed: tiles });
      const arrive = 200 + tiles * 300;
      const samples: { ms: number; feet: Vector3[] }[] = [];
      play([avatar], { endMs: arrive + 1200, travels: [{ startMs: 200, tiles, msPerTile: 300 }] }, 60, (ms) => {
        samples.push({ ms, feet: ['FootL', 'FootR'].map((name) => avatar.bone(name).getWorldPosition(new Vector3())) });
      });
      expect(avatar.animator.director.clip).toBe('Idle');
      slides.push(footSlide(samples, arrive, arrive + 1100, true));
      strict.push(footSlide(samples, arrive, arrive + 1100, false));
    }
    expect(Math.max(...slides)).toBeLessThan(0.1);
    // Counting feet stepping down into the stance too (the old hold measured 0.47-0.99 here).
    expect(Math.max(...strict)).toBeLessThan(0.25);
  });

  it('breathes while idle: the chest turns through at least 2 degrees', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 9 });
    const chest: Quaternion[] = [];
    play([avatar], { endMs: 6000 }, 60, (ms) => { if (ms > 300) chest.push(avatar.bone('Chest').getWorldQuaternion(new Quaternion())); });
    let range = 0;
    for (let i = 0; i < chest.length; i += 4) for (let j = i + 4; j < chest.length; j += 4) {
      const r = chest[i].clone().conjugate().multiply(chest[j]);
      range = Math.max(range, 2 * Math.atan2(Math.hypot(r.x, r.y, r.z), Math.abs(r.w)) * 180 / Math.PI);
    }
    expect(range).toBeGreaterThanOrEqual(2);
  });

  it('shows the killing blow land: Hit at impact, then the fall, never standing back up in between', () => {
    const avatar = makeAvatar(rig.scene, set, { seed: 4 });
    // A stick swing's event arrives at 200ms with the defender already dead; the blow lands 300ms later.
    const timeline: Timeline = { endMs: 2200, deadFrom: 200, cues: [{ clip: 'Hit', durationMs: 400, seq: 1, at: 500, role: 'reaction', arrive: 200 }] };
    const rows: { ms: number; clip: string; head: number }[] = [];
    play([avatar], timeline, 60, (ms) => rows.push({ ms, clip: avatar.animator.director.clip, head: avatar.bone('Head').getWorldPosition(new Vector3()).y }));
    const standing = rows[5].head;
    const hit = rows.find((r) => r.clip === 'Hit')!, fall = rows.find((r) => r.clip === 'Defeat')!;
    // Still standing until the blow lands, then the Hit, then Defeat.
    expect(rows.filter((r) => r.ms < 500).every((r) => r.clip === 'Idle')).toBe(true);
    expect(hit.ms).toBeGreaterThanOrEqual(500);
    expect(fall.ms - 500).toBeGreaterThanOrEqual(HIT_BEFORE_DEFEAT_MS);
    expect(fall.ms - 200).toBeLessThanOrEqual(500 + 17);
    // Once hit, the head never comes back up to standing height...
    const lowest = Math.min(...rows.filter((r) => r.ms >= hit.ms + 50 && r.ms <= fall.ms).map((r) => r.head));
    expect(lowest).toBeLessThan(standing - 0.04);
    for (const r of rows.filter((x) => x.ms >= hit.ms + 50)) expect(r.head, `${r.ms}ms`).toBeLessThan(standing - 0.03);
    // ...and from the moment the fall takes over it only goes down.
    const falling = rows.filter((r) => r.ms >= fall.ms);
    for (let i = 1; i < falling.length; i++) expect(falling[i].head).toBeLessThanOrEqual(falling[i - 1].head + 1e-3);
    expect(falling.at(-1)!.head).toBeLessThan(1);
  });
});
