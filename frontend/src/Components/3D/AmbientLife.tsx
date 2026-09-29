import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Frustum, BufferGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, MeshLambertMaterial, Object3D, OctahedronGeometry, Sphere, Vector3 } from 'three';
import { HEDGE_RING } from '@sim';
import { nearestAvatar } from '../../animation/avatarRegistry';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';

/**
 * Client-only wildlife: birds that peck in the Grove and scatter when someone
 * walks up, crabs that scuttle along the Coast and flee, and drifting glow
 * motes over the Grove. Three instanced draws with a few dozen vertices each,
 * seeded per area so every client sees the same flock. All state lives in
 * preallocated typed arrays; nothing is allocated per frame. A whole group is
 * skipped while its area is outside the view, and Low graphics halves the
 * critters and drops the motes.
 */

const BIRDS = 12, CRABS = 10, MOTES = 36;
const FLEE_BIRD = 3.2, FLEE_CRAB = 2.6;
const GROVE = HEDGE_RING - 2; // stay clear of the hedge

/** Frame-time accounting, exposed for perf captures (window.__berigameAmbient). */
export const ambientStats = { frames: 0, ms: 0, state: null as unknown };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A dart-shaped bird: body plus two wings, 12 vertices, vertex coloured. */
function birdGeometry(): BufferGeometry {
  const p = [
    // body (two tris, a thin diamond along +z)
    0, 0.06, 0.16, -0.05, 0.04, -0.02, 0.05, 0.04, -0.02,
    -0.05, 0.04, -0.02, 0, 0.02, -0.16, 0.05, 0.04, -0.02,
    // wings (flap by scaling the instance's x)
    0.03, 0.05, 0.05, 0.22, 0.07, -0.02, 0.03, 0.05, -0.07,
    -0.03, 0.05, 0.05, -0.03, 0.05, -0.07, -0.22, 0.07, -0.02,
  ];
  const c: number[] = [];
  for (let i = 0; i < 12; i++) { const wing = i >= 6; c.push(wing ? 0.85 : 0.35, wing ? 0.82 : 0.24, wing ? 0.78 : 0.18); }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(p, 3));
  g.setAttribute('color', new Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

/** A low crab: a flat octahedron shell. */
const crabGeometry = () => new OctahedronGeometry(0.16, 0).scale(1.3, 0.45, 0.9).translate(0, 0.07, 0);
/** A butterfly / mote: two flat triangles, flapped by scaling x. */
const moteGeometry = () => new OctahedronGeometry(0.09, 0).scale(1.4, 0.25, 1);

const birdMat = new MeshLambertMaterial({ vertexColors: true, side: 2 });
const crabMat = new MeshLambertMaterial({ color: '#d9603b' });
const moteMat = new MeshBasicMaterial({ color: '#ffffff' });
const MOTE_COLORS = ['#fff3a8', '#ffd1e8', '#ffffff', '#ffb347', '#c9e8ff'].map((c) => new Color(c));

const dummy = new Object3D();
const hide = new Matrix4().makeScale(0, 0, 0);
const groveSphere = new Sphere(new Vector3(0, 1, 0), GROVE + 2);
const noRaycast = () => null;

/** Bird modes. */
const PERCH = 0, FLY = 1, GONE = 2, LAND = 3;

function groveSpot(r: () => number, out: Float32Array, i: number) {
  out[i * 2] = (r() * 2 - 1) * GROVE;
  out[i * 2 + 1] = (r() * 2 - 1) * GROVE;
}
function coastSpot(r: () => number, out: Float32Array, i: number) {
  // Chebyshev ring HEDGE_RING+2 .. 23 around spawn (world origin): pick a side, then a spot along it.
  const d = HEDGE_RING + 2 + r() * (23 - HEDGE_RING - 2), along = (r() * 2 - 1) * d, side = (r() * 4) | 0;
  out[i * 2] = side === 0 ? d : side === 1 ? -d : along;
  out[i * 2 + 1] = side === 2 ? d : side === 3 ? -d : along;
}

const AmbientLife = () => {
  const graphics = useSettingsStore((s) => s.graphics);
  const low = graphics === 'low';
  const birds = useRef<InstancedMesh>(null);
  const crabs = useRef<InstancedMesh>(null);
  const motes = useRef<InstancedMesh>(null);
  const geo = useMemo(() => ({ bird: birdGeometry(), crab: crabGeometry(), mote: moteGeometry() }), []);
  const st = useMemo(() => {
    const rb = rng(0x6b17d), rc = rng(0xc0a57), rm = rng(0x3073);
    const bHome = new Float32Array(BIRDS * 2), bPos = new Float32Array(BIRDS * 3), bVel = new Float32Array(BIRDS * 3);
    const bMode = new Uint8Array(BIRDS), bTimer = new Float32Array(BIRDS), bPhase = new Float32Array(BIRDS), bYaw = new Float32Array(BIRDS);
    for (let i = 0; i < BIRDS; i++) {
      groveSpot(rb, bHome, i);
      bPos[i * 3] = bHome[i * 2]; bPos[i * 3 + 2] = bHome[i * 2 + 1];
      bPhase[i] = rb() * 10; bYaw[i] = rb() * 6.28;
    }
    const cPos = new Float32Array(CRABS * 2), cGoal = new Float32Array(CRABS * 2), cYaw = new Float32Array(CRABS), cTimer = new Float32Array(CRABS), cFlee = new Float32Array(CRABS);
    for (let i = 0; i < CRABS; i++) { coastSpot(rc, cPos, i); cGoal[i * 2] = cPos[i * 2]; cGoal[i * 2 + 1] = cPos[i * 2 + 1]; cYaw[i] = rc() * 6.28; cTimer[i] = rc() * 3; }
    const mSeed = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES * 4; i++) mSeed[i] = rm();
    const out = { rb, rc, bHome, bPos, bVel, bMode, bTimer, bPhase, bYaw, cPos, cGoal, cYaw, cTimer, cFlee, mSeed };
    ambientStats.state = out; // read by capture scripts
    return out;
  }, []);

  useLayoutEffect(() => {
    for (const m of [birds.current, crabs.current, motes.current]) if (m) { m.frustumCulled = false; m.raycast = noRaycast; }
    if (birds.current) birds.current.count = low ? BIRDS / 2 : BIRDS;
    if (crabs.current) crabs.current.count = low ? CRABS / 2 : CRABS;
    if (motes.current) { motes.current.visible = !low; for (let i = 0; i < MOTES; i++) motes.current.setColorAt(i, MOTE_COLORS[i % MOTE_COLORS.length]); motes.current.instanceColor!.needsUpdate = true; }
  }, [low]);

  useFrame((state, delta) => {
    const t0 = performance.now();
    const dt = Math.min(delta, 0.1), time = state.clock.elapsedTime;
    const reduced = useSettingsStore.getState().reduceMotion;
    const cam = state.camera;
    // One sphere-vs-frustum test for the Grove; the Coast rings the camera, so it is always tested per frame by the GPU only.
    frustum.setFromProjectionMatrix(proj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const groveOn = frustum.intersectsSphere(groveSphere);
    const b = birds.current, c = crabs.current, m = motes.current;
    const s = st;

    if (b) {
      b.visible = groveOn;
      if (groveOn) {
        const n = b.count;
        for (let i = 0; i < n; i++) {
          const k = i * 3;
          let mode = s.bMode[i];
          s.bTimer[i] -= dt;
          if (mode === PERCH || mode === LAND) {
            const near = nearestAvatar(s.bPos[k], s.bPos[k + 2]);
            if (near.d2 < FLEE_BIRD * FLEE_BIRD) {
              // Scatter: up and away from the intruder, with a little spread.
              let dx = s.bPos[k] - near.x, dz = s.bPos[k + 2] - near.z;
              const len = Math.hypot(dx, dz) || 1;
              const spread = Math.sin(s.bPhase[i] * 7.3) * 0.6;
              dx /= len; dz /= len;
              const sp = reduced ? 3 : 5.5;
              s.bVel[k] = (dx - dz * spread) * sp; s.bVel[k + 1] = reduced ? 2 : 3.6; s.bVel[k + 2] = (dz + dx * spread) * sp;
              mode = FLY; s.bTimer[i] = 2.2;
            }
          }
          if (mode === PERCH) {
            // Peck and hop in place.
            s.bPos[k + 1] = Math.max(0, Math.sin(time * 3 + s.bPhase[i]) - 0.93) * 1.2;
            if (s.bTimer[i] < 0) { s.bYaw[i] += (Math.sin(s.bPhase[i] + time) > 0 ? 1 : -1) * 0.9; s.bTimer[i] = 1.5 + (i % 5) * 0.4; }
          } else if (mode === FLY) {
            s.bVel[k + 1] += dt * 1.5;
            s.bPos[k] += s.bVel[k] * dt; s.bPos[k + 1] += s.bVel[k + 1] * dt; s.bPos[k + 2] += s.bVel[k + 2] * dt;
            s.bYaw[i] = Math.atan2(s.bVel[k], s.bVel[k + 2]);
            if (s.bTimer[i] < 0) { mode = GONE; s.bTimer[i] = 6 + (i % 4); }
          } else if (mode === GONE) {
            if (s.bTimer[i] < 0) {
              // Glide back in to a fresh spot from above.
              groveSpot(s.rb, s.bHome, i);
              s.bPos[k] = s.bHome[i * 2] - 6; s.bPos[k + 1] = 7; s.bPos[k + 2] = s.bHome[i * 2 + 1] - 6;
              mode = LAND;
            }
          } else {
            const hx = s.bHome[i * 2], hz = s.bHome[i * 2 + 1];
            const dx = hx - s.bPos[k], dy = -s.bPos[k + 1], dz = hz - s.bPos[k + 2];
            const f = Math.min(1, dt * 1.4);
            s.bPos[k] += dx * f; s.bPos[k + 1] += dy * f; s.bPos[k + 2] += dz * f;
            s.bYaw[i] = Math.atan2(dx, dz);
            if (dx * dx + dy * dy + dz * dz < 0.01) { mode = PERCH; s.bPos[k + 1] = 0; s.bTimer[i] = 1; }
          }
          s.bMode[i] = mode;
          if (mode === GONE) { b.setMatrixAt(i, hide); continue; }
          const flying = mode === FLY || mode === LAND;
          const flap = flying ? 0.35 + 0.65 * Math.abs(Math.sin(time * 22 + s.bPhase[i])) : 0.45;
          dummy.position.set(s.bPos[k], s.bPos[k + 1] + 0.02, s.bPos[k + 2]);
          dummy.rotation.set(0, s.bYaw[i], 0);
          dummy.scale.set(2.4 * flap + 0.6, 2.4, 2.4);
          dummy.updateMatrix();
          b.setMatrixAt(i, dummy.matrix);
        }
        b.instanceMatrix.needsUpdate = true;
      }
    }

    if (c) {
      const n = c.count;
      for (let i = 0; i < n; i++) {
        const k = i * 2;
        let x = s.cPos[k], z = s.cPos[k + 1];
        const near = nearestAvatar(x, z);
        if (near.d2 < FLEE_CRAB * FLEE_CRAB) {
          let dx = x - near.x, dz = z - near.z;
          const len = Math.hypot(dx, dz) || 1;
          dx /= len; dz /= len;
          s.cGoal[k] = x + dx * 3; s.cGoal[k + 1] = z + dz * 3; s.cFlee[i] = 1;
        } else if ((s.cTimer[i] -= dt) < 0) {
          // A short sideways wander.
          s.cTimer[i] = 2 + s.rc() * 4; s.cFlee[i] = 0;
          const a = s.cYaw[i] + (s.rc() < 0.5 ? 1.57 : -1.57);
          const d = 0.4 + s.rc() * 1.2;
          s.cGoal[k] = x + Math.sin(a) * d; s.cGoal[k + 1] = z + Math.cos(a) * d;
        }
        // Keep to the beach ring.
        const gx = s.cGoal[k], gz = s.cGoal[k + 1], ring = Math.max(Math.abs(gx), Math.abs(gz));
        if (ring < HEDGE_RING + 2 || ring > 24) { const sc = ring < HEDGE_RING + 2 ? (HEDGE_RING + 2) / ring : 24 / ring; s.cGoal[k] = gx * sc; s.cGoal[k + 1] = gz * sc; }
        const dx = s.cGoal[k] - x, dz = s.cGoal[k + 1] - z, dist = Math.hypot(dx, dz);
        const speed = s.cFlee[i] ? (reduced ? 1.6 : 3.2) : 0.7;
        const moving = dist > 0.03;
        if (moving) { s.cYaw[i] = Math.atan2(-dz, dx); const st2 = Math.min(dist, speed * dt); x += (dx / dist) * st2; z += (dz / dist) * st2; }
        s.cPos[k] = x; s.cPos[k + 1] = z;
        dummy.position.set(x, moving ? Math.abs(Math.sin(time * 30 + i)) * 0.02 : 0, z);
        // Crabs walk sideways: the shell's long axis (x) lies along the travel.
        dummy.rotation.set(0, s.cYaw[i] + (moving ? Math.sin(time * 28 + i) * 0.12 : 0), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        c.setMatrixAt(i, dummy.matrix);
      }
      c.instanceMatrix.needsUpdate = true;
    }

    if (m) {
      m.visible = groveOn && !low;
      if (m.visible) {
        for (let i = 0; i < MOTES; i++) {
          const q = i * 4, a = s.mSeed[q], bb = s.mSeed[q + 1], cc = s.mSeed[q + 2], d = s.mSeed[q + 3];
          const tt = time * (0.15 + d * 0.2);
          dummy.position.set(
            (a * 2 - 1) * GROVE + Math.sin(tt + cc * 9) * 1.6,
            0.5 + bb * 1.6 + Math.sin(tt * 2.3 + a * 5) * 0.35,
            (cc * 2 - 1) * GROVE + Math.cos(tt * 0.8 + bb * 7) * 1.6,
          );
          dummy.rotation.set(0, tt * 3 + a * 6, 0);
          dummy.scale.set(0.25 + 0.75 * Math.abs(Math.sin(time * (9 + d * 6) + a * 20)), 1, 1);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
        }
        m.instanceMatrix.needsUpdate = true;
      }
    }
    ambientStats.frames++; ambientStats.ms += performance.now() - t0;
  });

  return (
    <>
      <instancedMesh ref={birds} args={[geo.bird, birdMat, BIRDS]} />
      <instancedMesh ref={crabs} args={[geo.crab, crabMat, CRABS]} />
      <instancedMesh ref={motes} args={[geo.mote, moteMat, MOTES]} />
    </>
  );
};

const frustum = new Frustum();
const proj = new Matrix4();

if (typeof window !== 'undefined') (window as any).__berigameAmbient = ambientStats;

export default React.memo(AmbientLife);
