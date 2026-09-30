import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BufferGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Vector3 } from 'three';
import {
  EventKind, GIANT_SLAM_WINDUP_TICKS, GIANT_STOMP_WINDUP_TICKS, GiantAttack, GiantState, TICK_MS, attackRadius, giantHpAt, tileToWorld,
  formatCountdown,
} from '@sim';
import { useGiantRaid, useNow } from '../../spacetime/hooks';
import type { Giant as GiantRow } from '../../module_bindings/types';
import { useGameActions } from '../../spacetime/actions';
import { useGiantStore } from '../../spacetime/stores/giantStore';
import { tickClock } from '../../spacetime/tickClock';
import { useUserInputStore } from '../../store';
import DamageNumber from './DamageNumber';
import { LowPolyBuilder, coastMaterial, linear } from './nodes/lowPoly';

/*
 * F3 "The Giant": a mossy stone giant, about 4.3 units tall over its 3x3
 * footprint. Procedural flat-shaded vertex-colour parts (body, two arms, two
 * legs) on the shared low-poly material; animation is transforms only (no
 * skinning), driven per frame from refs without allocating:
 * idle breathing, a wind-up (arms overhead, or a raised foot for the stomp),
 * the slam, a flinch when hit, and a topple into rubble when defeated.
 * Between scheduled raids it sleeps: sat down, slumped forward, eyes shut,
 * with a slow deep breath (blended in and out, so waking is a stand-up).
 */
const STONE = linear(0x7d8088), STONE_DARK = linear(0x5f636b), STONE_LIGHT = linear(0x9a9ca2), MOSS = linear(0x6f8f3e), MOSS_DARK = linear(0x557232);
const EARTH = linear(0x6b5a48);

function buildBody(): BufferGeometry {
  const b = new LowPolyBuilder();
  // Torso: a big boulder, mossy shoulders; a lighter belly slab.
  b.rock(new Vector3(0, 2.35, 0), 1.0, new Vector3(1.3, 1.08, 0.92), { segments: 8, seed: 3, jitter: 0.18, colors: [STONE, STONE_DARK, STONE], top: MOSS });
  b.rock(new Vector3(0, 2.05, 0.55), 0.55, new Vector3(1.2, 1.0, 0.45), { segments: 6, seed: 4, colors: [STONE_LIGHT, STONE] });
  // Hips.
  b.rock(new Vector3(0, 1.4, 0), 0.62, new Vector3(1.35, 0.6, 0.95), { segments: 7, seed: 5, colors: [STONE_DARK, EARTH] });
  // Head, sunk between the shoulders, with a heavy brow and moss cap.
  b.rock(new Vector3(0, 3.5, 0.18), 0.46, new Vector3(1.05, 0.95, 1), { segments: 7, seed: 6, colors: [STONE, STONE_LIGHT], top: MOSS_DARK });
  b.rock(new Vector3(0, 3.62, 0.5), 0.3, new Vector3(1.5, 0.45, 0.6), { segments: 5, seed: 7, colors: [STONE_DARK] });
  // Moss clumps and a boulder growth on the back.
  b.rock(new Vector3(-0.7, 3.1, -0.2), 0.3, new Vector3(1, 0.5, 1), { segments: 5, seed: 8, colors: [MOSS, MOSS_DARK] });
  b.rock(new Vector3(0.3, 2.7, -0.75), 0.42, new Vector3(1, 0.9, 0.7), { segments: 6, seed: 9, colors: [STONE_DARK, STONE] , top: MOSS });
  return b.build();
}

/** One arm hanging from its shoulder pivot (origin), +x outward for `side` = 1. */
function buildArm(side: number): BufferGeometry {
  const b = new LowPolyBuilder();
  const bark = [STONE, STONE_DARK];
  b.rock(new Vector3(0, 0, 0), 0.42, new Vector3(1.1, 0.9, 1), { segments: 6, seed: 20 + side, colors: [STONE, STONE_DARK], top: MOSS });
  b.log(new Vector3(0.05 * side, -0.1, 0), new Vector3(0.22 * side, -1.3, 0.08), 0.3, 0.26, { sides: 6, rings: 3, wobble: 0.04, seed: 22 + side, bark, cap: STONE_LIGHT });
  b.log(new Vector3(0.22 * side, -1.3, 0.08), new Vector3(0.28 * side, -2.25, 0.22), 0.28, 0.24, { sides: 6, rings: 2, seed: 24 + side, bark, cap: STONE_LIGHT });
  // A huge knuckled fist.
  b.rock(new Vector3(0.3 * side, -2.55, 0.26), 0.44, new Vector3(1, 0.95, 1.05), { segments: 7, seed: 26 + side, colors: [STONE_DARK, STONE] , top: STONE_LIGHT });
  return b.build();
}

/** One leg from its hip pivot (origin) down to the ground (y = -1.35). */
function buildLeg(side: number): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0, 0), new Vector3(0.06 * side, -1.0, 0.02), 0.4, 0.34, { sides: 6, rings: 2, seed: 30 + side, bark: [STONE_DARK, STONE], cap: STONE });
  b.rock(new Vector3(0.06 * side, -1.15, 0.16), 0.38, new Vector3(1.1, 0.55, 1.35), { segments: 6, seed: 32 + side, colors: [STONE_DARK, EARTH], top: STONE });
  return b.build();
}

let parts: { body: BufferGeometry; armL: BufferGeometry; armR: BufferGeometry; legL: BufferGeometry; legR: BufferGeometry } | null = null;
const giantParts = () => parts ??= { body: buildBody(), armL: buildArm(-1), armR: buildArm(1), legL: buildLeg(-1), legR: buildLeg(1) };

const eyeMat = new MeshBasicMaterial({ color: '#ffb347' });
const plane = new PlaneGeometry(1, 1);
const dustRing = new RingGeometry(0.7, 1, 24);
const markMat = new MeshBasicMaterial({ color: '#d7342a', transparent: true, opacity: 0.28, depthWrite: false });
const markFillMat = new MeshBasicMaterial({ color: '#ff5a3c', transparent: true, opacity: 0.45, depthWrite: false });
const markEdgeMat = new MeshBasicMaterial({ color: '#ffe0d0', transparent: true, opacity: 0.8, depthWrite: false });
const dustMat = new MeshBasicMaterial({ color: '#d9c8a6', transparent: true, opacity: 0, depthWrite: false });

const SLAM_MS = 480;
const TOPPLE_MS = 1600;
const RISE_MS = 1200;
/** How long a raid-defeated Giant lies toppled before it sits up to sleep. */
const TOPPLE_HOLD_MS = 1400;
const FLINCH_MS = 450;
const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** `tick` is capped by the caller once it can no longer change what the bar shows. */
/** The Giant without game wiring (previews and tests pass `onAttack`). */
export const GiantModel = ({ giant, tick, onAttack }: { giant: GiantRow; tick: number; onAttack: (id: number) => void }) => {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const armL = useRef<Group>(null);
  const armR = useRef<Group>(null);
  const legR = useRef<Group>(null);
  const legL = useRef<Group>(null);
  const mark = useRef<Group>(null);
  const fill = useRef<Mesh>(null);
  const dust = useRef<Mesh>(null);
  const row = useRef(giant);
  row.current = giant;
  // performance.now() of the transitions this client saw (wind-up start, rise).
  const seen = useRef({ windupAt: -Infinity, riseAt: -Infinity, state: giant.state, yaw: 0, sleep: giant.state === GiantState.Asleep ? 1 : 0 });
  const eyes = useRef<Group>(null);
  const setClickedOtherObject = useUserInputStore((s: any) => s.setClickedOtherObject);

  const hit = useGiantStore((s) => s.hit);
  const p = giantParts();
  const [x, , z] = tileToWorld(giant);

  useEffect(() => {
    const s = seen.current;
    if (giant.state === GiantState.Windup && s.state !== GiantState.Windup) {
      // Back-date to the tick the wind-up started, so a late joiner sees the right progress.
      const windTicks = giant.attack === GiantAttack.Stomp ? GIANT_STOMP_WINDUP_TICKS : GIANT_SLAM_WINDUP_TICKS;
      const startTick = giant.stateUntilTick - windTicks;
      s.windupAt = performance.now() - Math.max(0, tickClock.tick - startTick) * tickClock.period;
    }
    if (s.state === GiantState.Defeated && giant.state !== GiantState.Defeated) s.riseAt = performance.now();
    s.state = giant.state;
  }, [giant.state, giant.stateUntilTick, giant.attack]);

  useFrame((state, delta) => {
    const g = row.current, s = seen.current;
    const r = root.current, bd = body.current, al = armL.current, ar = armR.current, lr = legR.current;
    if (!r || !bd || !al || !ar || !lr) return;
    const now = performance.now();
    const t = state.clock.elapsedTime;
    const fx = useGiantStore.getState();
    const stomp = g.attack === GiantAttack.Stomp;

    // Face the telegraphed tile (or the last blow's), smoothly.
    if (g.state !== GiantState.Defeated && (g.slamX !== g.x || g.slamZ !== g.z)) {
      const want = Math.atan2(g.slamX - g.x, g.slamZ - g.z);
      let d = want - s.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      s.yaw += d * 0.08;
    }
    r.rotation.y = s.yaw;
    // Sleep blend: 1 asleep, 0 awake; eased so waking reads as standing up.
    // A raid defeat: topple over first (TOPPLE_MS), lie there a moment, then rise into the sleeping sit.
    const sinceDefeat = now - useGiantStore.getState().defeatAt;
    const toppling = g.state === GiantState.Asleep && sinceDefeat >= 0 && sinceDefeat < TOPPLE_MS + TOPPLE_HOLD_MS;
    const sleepTarget = g.state === GiantState.Asleep && !toppling ? 1 : 0;
    s.sleep += (sleepTarget - s.sleep) * Math.min(1, delta * 2.2);
    if (Math.abs(s.sleep - sleepTarget) < 0.002) s.sleep = sleepTarget;
    const zz = s.sleep;

    // Defaults: idle breathing and a slow sway.
    let armX = -0.12 + Math.sin(t * 1.3) * 0.05, armZ = 0.12, lean = Math.sin(t * 0.9) * 0.03, legX = 0;
    bd.position.y = Math.sin(t * 1.6) * 0.04;
    r.position.y = 0;
    r.rotation.z = 0;

    if (g.state === GiantState.Defeated || toppling) {
      // Topple over and sink into a rubble mound (a raid defeat then eases into its sleeping sit).
      const k = smooth(clamp01((now - fx.defeatAt) / TOPPLE_MS));
      const out = toppling ? 1 - smooth(clamp01((sinceDefeat - TOPPLE_MS - TOPPLE_HOLD_MS + 600) / 600)) : 1;
      const done = (Number.isFinite(fx.defeatAt) ? k : 1) * out;
      r.rotation.z = -1.35 * done;
      r.position.y = -0.9 * done;
      armX = -0.4 * done; armZ = 0.6 * done; lean = 0.2 * done;
      bd.position.y = 0;
    } else {
      const since = now - fx.slamAt;
      if (g.state === GiantState.Windup) {
        const windTicks = stomp ? GIANT_STOMP_WINDUP_TICKS : GIANT_SLAM_WINDUP_TICKS;
        const k = smooth(clamp01((now - s.windupAt) / (windTicks * tickClock.period)));
        if (stomp) { legX = -0.75 * k; armZ = 0.12 + 0.9 * k; armX = -0.5 * k; lean = -0.12 * k; }
        else { armX = -0.12 - 2.7 * k; lean = -0.18 * k; }
        // A tremble as the blow gathers.
        bd.position.x = Math.sin(now * 0.06) * 0.03 * k;
      } else if (since < SLAM_MS + 900 && since >= 0) {
        // The blow: fast down, then hold while recovering.
        const k = smooth(clamp01(since / 140));
        const back = smooth(clamp01((since - SLAM_MS) / 900));
        if (stomp) { legX = -0.75 * (1 - k); armZ = 1.02 - 0.9 * back; armX = -0.5 * (1 - back); lean = 0.1 * k * (1 - back); }
        else { armX = (-2.82 + 1.62 * k) * (1 - back) + armX * back; lean = 0.28 * k * (1 - back); }
        bd.position.x = 0;
      } else bd.position.x = 0;
      // Rising after a respawn.
      const rise = clamp01((now - s.riseAt) / RISE_MS);
      if (rise < 1) r.position.y = -2.2 * (1 - smooth(rise));
    }

    // Flinch on a landed blow.
    const h = fx.hit;
    const since = h ? now - (h.at + h.delayMs) : Infinity;
    if (since >= 0 && since < FLINCH_MS && g.state !== GiantState.Defeated) {
      const k = 1 - since / FLINCH_MS;
      lean += -Math.sin(since / 60) * 0.06 * k;
    }

    if (zz > 0) {
      // Sat down with its back to a boulder: sunk, slumped forward, arms resting on the ground, a slow deep breath.
      const breath = Math.sin(t * 0.8);
      r.position.y = r.position.y * (1 - zz) - 0.95 * zz;
      bd.position.y = bd.position.y * (1 - zz) + breath * 0.06 * zz;
      lean = lean * (1 - zz) + (0.42 + breath * 0.03) * zz;
      armX = armX * (1 - zz) + 0.55 * zz;
      armZ = armZ * (1 - zz) + 0.35 * zz;
      legX = legX * (1 - zz) - 1.2 * zz;
    }
    const e = eyes.current;
    if (e) e.scale.y = zz > 0.5 ? 0.15 : 1;

    bd.rotation.x = lean;
    al.rotation.x = armX; ar.rotation.x = armX;
    al.rotation.z = -armZ; ar.rotation.z = armZ;
    lr.rotation.x = legX;
    const ll = legL.current;
    if (ll) ll.rotation.x = -1.2 * zz;

    // Telegraph: a red square over the area, filling from the centre as the blow nears.
    const m = mark.current, f = fill.current;
    if (m && f) {
      const on = g.state === GiantState.Windup;
      m.visible = on;
      if (on) {
        const windTicks = stomp ? GIANT_STOMP_WINDUP_TICKS : GIANT_SLAM_WINDUP_TICKS;
        const k = clamp01((now - s.windupAt) / (windTicks * tickClock.period));
        const size = attackRadius(g.attack) * 2 + 1;
        m.position.set(g.slamX - g.x, 0.03, g.slamZ - g.z);
        m.scale.set(size, 1, size);
        f.scale.set(Math.max(0.02, k), Math.max(0.02, k), 1);
        markMat.opacity = 0.22 + Math.sin(now * 0.02) * 0.08 + k * 0.15;
      }
    }
    // Dust burst where the blow landed.
    const d = dust.current;
    if (d) {
      const since = now - fx.slamAt;
      const on = since >= 0 && since < 700;
      d.visible = on;
      if (on) {
        const k = since / 700;
        const size = attackRadius(g.attack) + 0.5 + k * 1.2;
        d.position.set(g.slamX - g.x, 0.05, g.slamZ - g.z);
        d.scale.set(size, size, size);
        dustMat.opacity = 0.75 * (1 - k);
      }
    }
  });

  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    const down = row.current.state === GiantState.Defeated;
    const asleep = row.current.state === GiantState.Asleep;
    setClickedOtherObject({ connectionId: 'The Giant', e, dropdownOptions: [
      { label: asleep ? 'The Giant is asleep' : down ? 'The Giant is resting' : 'Attack The Giant', disabled: down || asleep, onClick: () => { onAttack(row.current.id); setClickedOtherObject(null); } },
    ] });
  };

  return (
    <group position={[x, 0, z]} name="giant" userData={{ berigameGiant: giant.id }}>
      <group ref={root}>
        <group ref={body}>
          <mesh geometry={p.body} material={coastMaterial()} castShadow />
          <group ref={eyes} position={[0, 3.52, 0.6]}>
            <mesh position={[-0.17, 0, 0]} material={eyeMat}><boxGeometry args={[0.12, 0.06, 0.04]} /></mesh>
            <mesh position={[0.17, 0, 0]} material={eyeMat}><boxGeometry args={[0.12, 0.06, 0.04]} /></mesh>
          </group>
          <group ref={armL} position={[-1.3, 2.95, 0.05]}><mesh geometry={p.armL} material={coastMaterial()} castShadow /></group>
          <group ref={armR} position={[1.3, 2.95, 0.05]}><mesh geometry={p.armR} material={coastMaterial()} castShadow /></group>
        </group>
        <group ref={legL} position={[-0.55, 1.35, 0]}><mesh geometry={p.legL} material={coastMaterial()} /></group>
        <group ref={legR} position={[0.55, 1.35, 0]}><mesh geometry={p.legR} material={coastMaterial()} /></group>
      </group>
      <group ref={mark} visible={false}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} geometry={plane} material={markMat} raycast={() => null} />
        <mesh ref={fill} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} geometry={plane} material={markFillMat} raycast={() => null} />
        {[[0, 0.5, 1, 0.04], [0, -0.5, 1, 0.04], [0.5, 0, 0.04, 1], [-0.5, 0, 0.04, 1]].map(([ex, ez, sx, sz], i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[ex, 0.01, ez]} scale={[sx, sz, 1]} geometry={plane} material={markEdgeMat} raycast={() => null} />
        ))}
      </group>
      <mesh ref={dust} visible={false} rotation={[-Math.PI / 2, 0, 0]} geometry={dustRing} material={dustMat} raycast={() => null} />
      {/* Invisible click target over the footprint. */}
      <mesh position={[0, 2.1, 0]} visible={false} onClick={onClick}><boxGeometry args={[3, 4.4, 3]} /><meshBasicMaterial /></mesh>
      {hit && <DamageNumber key={`giant-${hit.seq}`} playerPosition={{ x: 0, y: 0, z: 0 }} yOffset={4.6} kind={EventKind.Hit} text={String(hit.damage)} itemId={hit.itemId} appearAt={hit.at + hit.delayMs} />}
      <GiantBar giant={giant} tick={tick} />
    </group>
  );
};

/** HP bar and name over its head; a countdown while it rests. */
const GiantBar = ({ giant, tick }: { giant: GiantRow; tick: number }) => {
  if (giant.state === GiantState.Asleep) return <SleepLabel />;
  return <AwakeBar giant={giant} tick={tick} />;
};

/** "Zzz" and the time to its next wake (re-renders once a second, alone). */
const SleepLabel = () => {
  const raid = useGiantRaid();
  const now = useNow(1000);
  const wake = raid && !raid.awake ? Number(raid.nextWakeAtMicros / 1000n) : null;
  return (
    <Html position={[0, 3.3, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
      <div className="giant-hp" data-testid="giant-asleep">
        <div className="giant-zzz" aria-hidden="true">Z z z</div>
        <div className="giant-hp-name">{wake !== null ? `The Giant sleeps · wakes in ${formatCountdown(wake, now)}` : 'The Giant sleeps'}</div>
      </div>
    </Html>
  );
};

const AwakeBar = ({ giant, tick }: { giant: GiantRow; tick: number }) => {
  const eventHp = useGiantStore((s) => s.hp);
  const down = giant.state === GiantState.Defeated;
  const hp = down ? 0 : giant.lastHitTick === tick && eventHp !== null ? eventHp : giantHpAt(giant, tick);
  const restS = Math.max(0, Math.ceil(((giant.respawnTick - tick) * TICK_MS) / 1000));
  return (
    <Html position={[0, 5.0, 0]} center zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
      <div className="giant-hp">
        <div className="giant-hp-name">{down ? `The Giant rests · rises in ${restS}s` : `The Giant · ${hp}/${giant.maxHp}`}</div>
        {!down && (
          <div className="giant-hp-bar" role="meter" aria-label="The Giant" aria-valuenow={hp} aria-valuemax={giant.maxHp}>
            <div className="giant-hp-fill" style={{ width: `${(hp / Math.max(1, giant.maxHp)) * 100}%` }} />
          </div>
        )}
      </div>
    </Html>
  );
};

const Giant = ({ giant, tick }: { giant: GiantRow; tick: number }) => {
  const { attackGiant } = useGameActions();
  return <GiantModel giant={giant} tick={tick} onAttack={attackGiant} />;
};

export default React.memo(Giant);
