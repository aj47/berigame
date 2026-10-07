import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, Color, Fog, IcosahedronGeometry, InstancedMesh, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, Points, PointsMaterial, Vector3, type Group,
} from 'three';
import {
  BULLET_STRIDE, SPIRE_BOX, SPIRE_CENTRE, SPIRE_FLOOR, SPIRE_NONE, SPIRE_ORIGINS, inSpireCourt, spireFightBullets,
  spireStandable, tileToWorld, worldToTile, type Tile,
} from '@sim';
import { LowPolyBuilder, linear } from '../../Components/3D/nodes/lowPoly';
import { MOUSE_TAP_RADIUS, TOUCH_TAP_RADIUS, holdState, openMenuNear } from '../../Components/3D/tapAssist';
import { estimatedTick } from '../../fx/harvestProgress';
import { useGameActions } from '../../spacetime/actions';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useUserInputStore } from '../../store';
import { audio } from '../../audio';
import { useBossStore } from '../bossStore';
import { isOpenGround } from '../selectors';
import BulletLayer, { type BulletSource } from '../BulletLayer';
import SpireOverlay from './SpireOverlay';
import StarLayer from './StarLayer';
import { setSpireHover, spireView } from './spireView';

/**
 * The Sunken Spire's scene (FINAL_SPEC 7.4): its own background, fog and
 * lights (the overworld, AlphaIsland included, is unmounted inside), the
 * sealed glass floor with its own click-to-move, the dais, the 8 pillar
 * origins, the Shardmother, and the BulletLayer, StarLayer and SpireOverlay.
 * Loaded lazily through `loadSpireScene` and mounted by GameComponent while
 * you stand on the floor.
 */
export type SpireSceneProps = Record<string, never>;

const BG = '#0d0b18';
const [CX, , CZ] = tileToWorld(SPIRE_CENTRE);
const FLOOR_W = SPIRE_FLOOR.x1 - SPIRE_FLOOR.x0 + 1, FLOOR_H = SPIRE_FLOOR.z1 - SPIRE_FLOOR.z0 + 1;
/** Shardmother tint by phase (index 1..4): Bloom, Gale, Shatter, Nightfall. */
export const SHARDMOTHER_TINT = ['#ffd6f0', '#ffd6f0', '#9fe7ff', '#b79bff', '#ff6b6b'] as const;

// ---- Floor click-to-move ------------------------------------------------------------------------------------------

export interface FloorClickEvent {
  delta: number;
  point: { x: number; z: number };
  stopPropagation?: () => void;
  nativeEvent?: { clientX?: number; clientY?: number; pointerType?: string };
}
export interface FloorClickDeps {
  setTarget: (x: number, z: number) => unknown;
  /** Opens a teammate's menu under the tap instead of walking (tapAssist's openMenuNear). */
  menuNear?: (clientX: number, clientY: number, radius: number, native: unknown) => boolean;
  /** Shows the click marker on the chosen tile. */
  mark?: (tile: Tile) => void;
}

/**
 * The floor's own click handler, with GroundPlane's guards in the same order: a drag is not a click;
 * the event stops here; the release of a hold is not a tap; a tap beside a teammate opens its menu;
 * otherwise the tile under the click must be standable floor on your side of the boundary.
 * Returns the tile it walked to, or null.
 */
export function handleFloorClick(e: FloorClickEvent, deps: FloorClickDeps): Tile | null {
  if (e.delta > 5) return null;
  e.stopPropagation?.();
  if (holdState.active || performance.now() < holdState.suppressClickUntil) return null;
  const native = e.nativeEvent;
  if (native && typeof native.clientX === 'number' && typeof native.clientY === 'number' && deps.menuNear) {
    const radius = native.pointerType === 'mouse' ? MOUSE_TAP_RADIUS : TOUCH_TAP_RADIUS;
    if (deps.menuNear(native.clientX, native.clientY, radius, native)) return null;
  }
  useUserInputStore.getState().setClickedOtherObject(null);
  const tile = worldToTile(e.point.x, e.point.z);
  if (!spireStandable(tile) || !isOpenGround(tile, true)) return null;
  deps.mark?.(tile);
  deps.setTarget(tile.x, tile.z);
  return tile;
}

// ---- Art (module-level, built once per chunk load) ----------------------------------------------------------------

const tileGeo = new BoxGeometry(0.94, 0.12, 0.94).translate(0, -0.06, 0);
const seamGeo = new BoxGeometry(FLOOR_W + 0.3, 0.1, FLOOR_H + 0.3).translate(0, -0.1, 0);
const OBSIDIAN = '#2a2238', SEAM = '#5b4a8f', BRASS = '#8c6d3a';

function glassColumn(height: number, r0: number, r1: number, sides: number, seed: number, tint: number[]): BufferGeometry {
  const b = new LowPolyBuilder();
  b.log(new Vector3(0, 0, 0), new Vector3(0, height, 0), r0, r1, {
    sides, rings: 3, wobble: 0.03, seed, bark: tint.map(linear), cap: linear(0xd9c9ff),
  });
  return b.build();
}
const pillarGeo = glassColumn(2.8, 0.34, 0.24, 6, 3, [0x6d5bb0, 0x8a78d0, 0x5b4a8f]);
const daisGeo = glassColumn(0.45, 1.6, 1.45, 8, 5, [0x4b3c7a, 0x5b4a8f, 0x6d5bb0]);
const coreGeo = new IcosahedronGeometry(0.62, 0);
const crackGeo = new IcosahedronGeometry(0.66, 0);
const shardGeo = new OctahedronGeometry(0.2, 0).scale(0.7, 1.6, 0.7);

// ---- Scene --------------------------------------------------------------------------------------------------------

/**
 * Sets the dungeon's background and fog and returns the release. The release puts back what was there only while
 * the scene still holds the Spire's own objects: on the way out AlphaIsland's `<color>`/`<fog>` attach in React's
 * mutation phase, before this passive cleanup runs, so restoring unconditionally would overwrite the overworld's
 * fresh values with stale ones (and from the second visit on, with the Spire's dark fog).
 */
export function claimSpireAtmosphere(scene: { background: unknown; fog: unknown }): () => void {
  const prev = { bg: scene.background, fog: scene.fog };
  const mine = { bg: new Color(BG), fog: new Fog(BG, 18, 40) };
  scene.background = mine.bg;
  scene.fog = mine.fog;
  return () => {
    if (scene.background === mine.bg) scene.background = prev.bg;
    if (scene.fog === mine.fog) scene.fog = prev.fog;
  };
}

/** Background and fog for the dungeon; the overworld's own come back when AlphaIsland remounts. */
function SpireAtmosphere() {
  const scene = useThree((s) => s.scene);
  useEffect(() => claimSpireAtmosphere(scene as any), [scene]);
  return <>
    <hemisphereLight args={['#b9a8ff', '#1a1430', 0.75]} />
    <directionalLight position={[CX + 6, 14, CZ + 9]} intensity={0.9} color="#e8dcff" />
    <pointLight position={[CX, 3.2, CZ]} intensity={0.8} distance={14} color="#c6b5ff" />
  </>;
}

function SpireFloor() {
  const { setTarget } = useGameActions();
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const marker = useRef<Mesh>(null);
  const clickedAt = useRef(-Infinity);
  const tiles = useMemo(() => {
    const mesh = new InstancedMesh(tileGeo, new MeshStandardMaterial({ roughness: 0.35, metalness: 0.25, flatShading: true }), FLOOR_W * FLOOR_H);
    const m = new Matrix4(), c = new Color();
    let i = 0;
    for (let z = SPIRE_FLOOR.z0; z <= SPIRE_FLOOR.z1; z++) for (let x = SPIRE_FLOOR.x0; x <= SPIRE_FLOOR.x1; x++) {
      const [wx, , wz] = tileToWorld({ x, z });
      mesh.setMatrixAt(i, m.makeTranslation(wx, 0, wz));
      // The 72 court tiles are inlaid with brass; a faint checker breaks up the obsidian.
      c.set(inSpireCourt({ x, z }) ? BRASS : OBSIDIAN);
      if ((x + z) % 2 === 0) c.multiplyScalar(1.12);
      mesh.setColorAt(i++, c);
    }
    mesh.name = 'spire_floor';
    // The tiles sit far from the mesh origin; three 0.149 bounds instances by the geometry alone.
    mesh.frustumCulled = false;
    // Ground: never a tap-assist target (its own handler walks).
    mesh.userData.worldSurface = true;
    return mesh;
  }, []);
  useEffect(() => () => { (tiles.material as MeshStandardMaterial).dispose(); tiles.dispose(); }, [tiles]);
  useEffect(() => () => setSpireHover(null), []);

  useFrame(() => {
    const mk = marker.current;
    if (!mk) return;
    const age = (performance.now() - clickedAt.current) / 850;
    if (age >= 1 || age < 0) { mk.visible = false; return; }
    mk.visible = true;
    mk.scale.setScalar(0.8 + age * 0.45);
    (mk.material as MeshBasicMaterial).opacity = Math.max(0, 1 - age);
  });

  const onClick = (e: any) => {
    handleFloorClick(e, {
      setTarget,
      menuNear: (x, y, radius, native) => openMenuNear(scene, camera, gl.domElement.getBoundingClientRect(), x, y, radius, native as Event),
      mark: (tile) => {
        const [wx, , wz] = tileToWorld(tile);
        marker.current?.position.set(wx, 0.05, wz);
        clickedAt.current = performance.now();
      },
    });
  };
  const onPointerMove = (e: any) => {
    const tile = worldToTile(e.point.x, e.point.z);
    setSpireHover(spireStandable(tile) ? tile : null);
  };

  return <>
    <primitive object={tiles} onClick={onClick} onPointerMove={onPointerMove} onPointerOut={() => setSpireHover(null)} />
    <mesh geometry={seamGeo} position={[CX, 0, CZ]} raycast={() => null}>
      <meshStandardMaterial color={SEAM} roughness={0.6} emissive={SEAM} emissiveIntensity={0.25} />
    </mesh>
    {/* The inland sea far below the sealed floor. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CX, -2.2, CZ]} raycast={() => null}>
      <circleGeometry args={[48, 24]} /><meshBasicMaterial color="#120f24" />
    </mesh>
    <mesh ref={marker} visible={false} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.28, 0.36, 24]} /><meshBasicMaterial color="#e8dcff" transparent depthWrite={false} toneMapped={false} />
    </mesh>
  </>;
}

/** The dais and the 8 glass pillar origins; a pillar glows while its volley charges. */
function SpireArchitecture() {
  const pillars = useMemo(() => SPIRE_ORIGINS.slice(1).map(() => new MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.88 })), []);
  const dais = useMemo(() => new MeshBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.92 }), []);
  useEffect(() => () => { for (const m of pillars) m.dispose(); dais.dispose(); }, [pillars, dais]);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  useFrame(({ clock }) => {
    // Reduced motion: a steady glow instead of a pulse.
    const glow = spireView.pillarGlow, pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 10);
    pillars.forEach((m, i) => {
      const on = (glow >> (i + 1)) & 1;
      m.color.setScalar(on ? 1.35 + pulse * 0.4 : 1);
    });
    dais.color.setScalar((glow & 1) ? 1.3 + pulse * 0.3 : 1);
  });
  return <>
    <mesh geometry={daisGeo} material={dais} position={[CX, 0, CZ]} />
    {SPIRE_ORIGINS.slice(1).map((o, i) => {
      const [x, , z] = tileToWorld(o);
      return <mesh key={i} geometry={pillarGeo} material={pillars[i]} position={[x, 0, z]} raycast={() => null} />;
    })}
  </>;
}

/** Sorted unique fire ticks of a bullet array (memoized per array: one scan per pattern rotation). */
const fireTicksMemo = new WeakMap<Int32Array, number[]>();
export function fireTicksOf(bullets: Int32Array): number[] {
  let out = fireTicksMemo.get(bullets);
  if (!out) {
    const s = new Set<number>();
    for (let o = 0; o < bullets.length; o += BULLET_STRIDE) s.add(bullets[o]);
    out = [...s].sort((a, b) => a - b);
    fireTicksMemo.set(bullets, out);
  }
  return out;
}

/**
 * The Shardmother: an icosahedron core with 6 orbiting octahedron shards (about 70 triangles) floating
 * above the dais, tinted by phase, pulsing when a volley fires (with one `shard` sound per volley, never
 * per bullet), cracking as HP falls. Reduced motion: no pulse, a slow steady orbit.
 */
export function ShardmotherModel() {
  const root = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  const shards = useRef<(Mesh | null)[]>([]);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const mats = useMemo(() => ({
    core: new MeshBasicMaterial({ color: SHARDMOTHER_TINT[1], toneMapped: false }),
    crack: new MeshBasicMaterial({ color: '#1a0f2e', wireframe: true, transparent: true, opacity: 0, toneMapped: false }),
    shard: new MeshBasicMaterial({ color: SHARDMOTHER_TINT[1], toneMapped: false, transparent: true, opacity: 0.9 }),
  }), []);
  useEffect(() => () => { mats.core.dispose(); mats.crack.dispose(); mats.shard.dispose(); }, [mats]);
  const fx = useRef({ lastRt: -Infinity, pulseAt: -Infinity });
  const tint = useMemo(() => new Color(), []);
  const dark = useMemo(() => new Color('#2a1d3f'), []);

  useFrame(({ clock }) => {
    const fight = useBossStore.getState().fight;
    const t = clock.elapsedTime, now = performance.now();
    const phase = Math.min(4, Math.max(1, fight?.phase ?? 1));
    const frac = fight && fight.maxHp > 0 ? Math.max(0, Math.min(1, fight.hp / fight.maxHp)) : 1;
    // Volleys: a renderTick crossing a fire tick pulses the core and plays one shard sound.
    if (fight) {
      const rt = estimatedTick(now) - 1;
      const last = fx.current.lastRt;
      if (rt > last) {
        for (const F of fireTicksOf(spireFightBullets(fight))) {
          if (F > last && F <= rt && rt - F < 1) { fx.current.pulseAt = now; audio.play('shard', { x: CX, z: CZ, volume: 0.6 }); break; }
        }
        fx.current.lastRt = rt;
      }
    }
    tint.set(SHARDMOTHER_TINT[phase]);
    mats.core.color.copy(tint).lerp(dark, (1 - frac) * 0.45);
    mats.shard.color.copy(tint);
    mats.crack.opacity = (1 - frac) * 0.9;
    const k = Math.max(0, 1 - (now - fx.current.pulseAt) / 260);
    if (root.current) {
      root.current.position.y = 2.05 + (reduced ? 0 : Math.sin(t * 1.3) * 0.12);
      root.current.rotation.y = t * (reduced ? 0.15 : 0.5);
    }
    core.current?.scale.setScalar(reduced ? 1 : 1 + k * 0.16);
    const spread = 1.15 + (1 - frac) * 0.45;
    shards.current.forEach((s, i) => {
      if (!s) return;
      const a = (i / 6) * Math.PI * 2 + t * (reduced ? 0.2 : 0.9);
      const wobble = reduced ? 0 : Math.sin(t * 3 + i) * 0.08 * (1 - frac);
      s.position.set(Math.cos(a) * (spread + wobble), Math.sin(a * 2 + t) * 0.18, Math.sin(a) * (spread + wobble));
      s.rotation.set(0, -a, reduced ? 0 : t * 1.7 + i);
    });
  });

  return <group ref={root} position={[CX, 2.05, CZ]}>
    <mesh ref={core} geometry={coreGeo} material={mats.core} raycast={() => null}>
      <mesh geometry={crackGeo} material={mats.crack} raycast={() => null} />
    </mesh>
    {Array.from({ length: 6 }, (_, i) => (
      <mesh key={i} ref={(m) => { shards.current[i] = m; }} geometry={shardGeo} material={mats.shard} raycast={() => null} />
    ))}
  </group>;
}

/** Decorative motes rising from the sea around the floor (skipped on Low graphics and with reduced motion). */
function SpireMotes() {
  const points = useMemo(() => {
    const n = 70, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = (i * 2.399) % (Math.PI * 2), r = 9.5 + ((i * 37) % 11);
      pos[i * 3] = CX + Math.cos(a) * r; pos[i * 3 + 1] = (i * 0.37) % 6 - 2; pos[i * 3 + 2] = CZ + Math.sin(a) * r;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const p = new Points(g, new PointsMaterial({ color: '#b79bff', size: 0.12, transparent: true, opacity: 0.6, depthWrite: false, blending: AdditiveBlending }));
    p.raycast = () => {};
    p.frustumCulled = false;
    return p;
  }, []);
  useEffect(() => () => { points.geometry.dispose(); (points.material as PointsMaterial).dispose(); }, [points]);
  useFrame((_, dt) => {
    const a = points.geometry.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < a.count; i++) { let y = a.getY(i) + dt * 0.35; if (y > 4) y = -2; a.setY(i, y); }
    a.needsUpdate = true;
  });
  return <primitive object={points} />;
}

/** The camera's azimuth around the arena, for camera-relative step keys (stepInput). */
function AzimuthProbe() {
  useFrame(({ camera }) => { spireView.azimuth = Math.atan2(camera.position.x - CX, camera.position.z - CZ); });
  return null;
}

const NO_BULLETS: BulletSource | null = null;
/** Your run's bullets (prev and cur patterns) in the Spire's render box, read every frame. */
function spireBulletSource(): BulletSource | null {
  const fight = useBossStore.getState().fight;
  if (!fight || (fight.curKind === SPIRE_NONE && fight.prevKind === SPIRE_NONE)) return NO_BULLETS;
  return { bullets: spireFightBullets(fight), boxX0: SPIRE_BOX.x0, boxZ0: SPIRE_BOX.z0, boxX1: SPIRE_BOX.x1, boxZ1: SPIRE_BOX.z1 };
}

export default function SpireScene(_props: SpireSceneProps) {
  const graphics = useSettingsStore((s) => s.graphics);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  return <group name="spire-scene">
    <SpireAtmosphere />
    <AzimuthProbe />
    <SpireFloor />
    <SpireArchitecture />
    <ShardmotherModel />
    <BulletLayer source={spireBulletSource} palette="spire" />
    <StarLayer />
    <SpireOverlay />
    {graphics !== 'low' && !reduced && <SpireMotes />}
  </group>;
}
