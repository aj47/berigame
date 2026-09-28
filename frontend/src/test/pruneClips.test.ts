import { beforeAll, describe, expect, it } from 'vitest';
import { STICK_SWING_CLIP, withStickSwing } from '../animation/stickSwing';
import { avatarClips, pruneRestTracks } from '../animation/pruneClips';
import { stanceSet } from '../animation/stance';
import { loadAdventurerRig, type AdventurerRig } from './adventurerRig';
import { makeAvatar, play, type Timeline, type TimelineCue } from './animationTimeline';

let rig: AdventurerRig;
beforeAll(async () => { rig = await loadAdventurerRig(); });

const swing = (seq: number, at: number): TimelineCue => ({ clip: STICK_SWING_CLIP, durationMs: 620, seq, at, role: 'action' });
const strike = (seq: number, at: number): TimelineCue => ({ clip: 'Strike', durationMs: 500, seq, at, role: 'action' });
/**
 * Every transition the director makes: spawn, start, arrival hold, Stop,
 * Idle, repeated punches and swings (crossfading into their own alias
 * actions), a hit, running again, and a killing blow into Defeat.
 */
const SEQUENCE: Timeline = {
  endMs: 6200,
  travels: [{ startMs: 200, tiles: 3, msPerTile: 300 }, { startMs: 3900, tiles: 2, msPerTile: 300 }],
  cues: [
    strike(1, 1700), strike(2, 2200), swing(3, 2800), swing(4, 3420),
    { clip: 'Hit', durationMs: 400, seq: 5, at: 4700, role: 'reaction', arrive: 4400 },
    { clip: 'Hit', durationMs: 400, seq: 6, at: 5300, role: 'reaction', arrive: 5000 },
  ],
  deadFrom: 5000,
};

describe('pruneRestTracks', () => {
  it('keeps every clip, dropping only channels that hold the rest pose', () => {
    const full = withStickSwing(rig.scene, rig.animations);
    const pruned = avatarClips(rig.scene, rig.animations);
    expect(avatarClips(rig.scene, rig.animations)).toBe(pruned);
    expect(pruned.map((clip) => [clip.name, clip.duration])).toEqual(full.map((clip) => [clip.name, clip.duration]));
    const rest = new Map<string, number[]>();
    rig.scene.traverse((object) => {
      rest.set(`${object.name}.position`, object.position.toArray());
      rest.set(`${object.name}.quaternion`, object.quaternion.toArray());
      rest.set(`${object.name}.scale`, object.scale.toArray());
    });
    let before = 0, after = 0;
    full.forEach((clip, index) => {
      const kept = new Set(pruned[index].tracks.map((track) => track.name));
      before += clip.tracks.length; after += kept.size;
      for (const track of clip.tracks) {
        if (kept.has(track.name)) continue;
        // A dropped track is constant, at the node's rest value (or its negated quaternion).
        const value = rest.get(track.name)!, size = track.getValueSize();
        for (let i = 0; i < track.values.length; i++) {
          const v = track.values[i], r = value[i % size];
          expect(Math.min(Math.abs(v - r), track.name.endsWith('.quaternion') ? Math.abs(v + r) : Infinity), `${clip.name} ${track.name}`).toBeLessThan(1e-5);
        }
      }
    });
    // The baked GLB only exports rotation channels (plus Hips position); pruning drops the ones held at rest.
    expect(after).toBeLessThan(before);
    // Standing clips leave Neck and Head to the procedural layer: Idle binds neither.
    expect(pruned.find((clip) => clip.name === 'Idle')!.tracks.some((track) => /^(Neck|Head)\./.test(track.name))).toBe(false);
  });

  it('is a no-op on a clip with nothing at rest', () => {
    const clips = pruneRestTracks(rig.scene, []);
    expect(clips).toEqual([]);
  });

  it('poses every bone the same as the unpruned clips through a sequence of blends (<= 3e-5)', () => {
    const full = stanceSet(rig.scene, withStickSwing(rig.scene, rig.animations));
    const pruned = stanceSet(rig.scene, avatarClips(rig.scene, rig.animations));
    const a = makeAvatar(rig.scene, full, { seed: 11, procedural: false });
    const b = makeAvatar(rig.scene, pruned, { seed: 11, procedural: false });
    const bonesA: any[] = [], bonesB: any[] = [];
    a.model.traverse((object: any) => { if (object.isBone) bonesA.push(object); });
    b.model.traverse((object: any) => { if (object.isBone) bonesB.push(object); });
    expect(bonesA.length).toBe(27); // 26 + the PropR stick socket
    let worst = 0, where = '';
    const clips = new Set<string>();
    play([a, b], SEQUENCE, 60, (ms) => {
      clips.add(a.animator.director.clip);
      bonesA.forEach((bone, i) => {
        const x = bone.matrixWorld.elements, y = bonesB[i].matrixWorld.elements;
        for (let k = 0; k < 16; k++) {
          const error = Math.abs(x[k] - y[k]);
          if (error > worst) { worst = error; where = `${bone.name} @${ms.toFixed(0)}ms`; }
        }
      });
    });
    expect([...clips].sort()).toEqual(['Defeat', 'Hit', 'Idle', 'Run', STICK_SWING_CLIP, 'Stop', 'Strike'].sort());
    // Each dropped track is within 1e-5 of rest; down a bone chain that adds up to a few 1e-5.
    expect(worst, where).toBeLessThanOrEqual(3e-5);
    // Fewer bindings, same pose.
    expect((b.animator.mixer as any)._bindings.length).toBeLessThan((a.animator.mixer as any)._bindings.length);
  });
});
