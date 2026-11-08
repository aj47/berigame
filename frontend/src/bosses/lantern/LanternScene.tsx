import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import {
  BoxGeometry, BufferGeometry, Color, ConeGeometry, CylinderGeometry, Fog, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  RingGeometry, SphereGeometry, type Group,
} from 'three';
import {
  LANTERN_CELLS, LANTERN_CENTRE_TILE, LANTERN_FLOOR, LANTERN_PLANK, LANTERN_SPRINGS, LANTERN_STANDABLE, LanternStage, TILE_ORIGIN,
  lanternStandable, lanternTile, tileToWorld, worldToTile, type Tile,
} from '@sim';
import { MOUSE_TAP_RADIUS, TOUCH_TAP_RADIUS, holdState, openMenuNear } from '../../Components/3D/tapAssist';
import { useGameActions } from '../../spacetime/actions';
import { useMyPlayer, useTick } from '../../spacetime/hooks';
import { useSettingsStore } from '../../spacetime/stores/settingsStore';
import { useUserInputStore } from '../../store';
import { useBossStore } from '../bossStore';
import DangerTiles from '../DangerTiles';
import { isOpenGround } from '../selectors';
import { lanternDanger, lanternStatus } from './lanternModel';

/**
 * Lanternmaw's Drowned Hollow (BOSSES.md 9.3): its own fog and lights (the
 * overworld is unmounted while you stand here), the 15 x 15 floor with the
 * boardwalk planks as wood and the shallows as murky water that rises at high
 * tide, the four glow springs, the maw with the angler and its swaying lure,
 * and the telegraphs from the shared sim: red for lanternHazardMask at T + 1,
 * amber for T + 2, the published spring with its countdown, and the choke.
 * Loaded lazily through `loadLanternScene` and mounted by GameComponent.
 */
export type LanternSceneProps = Record<string, never>;

const BG = '#0b1410';
const [CX, , CZ] = tileToWorld(LANTERN_CENTRE_TILE);
const SIZE = LANTERN_FLOOR.x1 - LANTERN_FLOOR.x0 + 1;
/**
 * Avatars stand at y = 0, so the plank tops are flush with it; the mud sits lower, under a shallow sheen of water at
 * low tide that rises to just under the plank tops at high tide.
 */
export const PLANK_TOP = 0, MUD_TOP = -0.14, WATER_LOW = -0.08, WATER_HIGH = -0.012;
const HAZARD_Y = PLANK_TOP + 0.03;
const WOOD = '#7a5a36', WOOD_DARK = '#5e4429', MUD = '#3b3a22', SPRING_COLOR = '#7dffd0';

// ---- Floor click-to-move ------------------------------------------------------------------------------------------

export interface LanternFloorClick {
  delta: number;
  point: { x: number; z: number };
  stopPropagation?: () => void;
  nativeEvent?: { clientX?: number; clientY?: number; pointerType?: string };
}

/**
 * The floor's own click handler with the Spire floor's guards: a drag is not a click, the release of a hold is not
 * a tap, a tap beside a teammate opens its menu; otherwise the tile must be standable lantern floor. Returns the tile.
 */
export function handleLanternFloorClick(e: LanternFloorClick, deps: {
  setTarget: (x: number, z: number) => unknown;
  menuNear?: (clientX: number, clientY: number, radius: number, native: unknown) => boolean;
  mark?: (tile: Tile) => void;
}): Tile | null {
  if (e.delta > 5) return null;
  e.stopPropagation?.();
  if (holdState.active || performance.now() < holdState.suppressClickUntil) return null;
  const native = e.nativeEvent;
  if (native && typeof native.clientX === 'number' && typeof native.clientY === 'number' && deps.menuNear) {
    if (deps.menuNear(native.clientX, native.clientY, native.pointerType === 'mouse' ? MOUSE_TAP_RADIUS : TOUCH_TAP_RADIUS, native)) return null;
  }
  useUserInputStore.getState().setClickedOtherObject(null);
  const tile = worldToTile(e.point.x, e.point.z);
  if (!lanternStandable(tile) || !isOpenGround(tile, 'lantern')) return null;
  deps.mark?.(tile);
  deps.setTarget(tile.x, tile.z);
  return tile;
}

// ---- Art -------------------------------------------------------------------------------------------------------------

const plankGeo = new BoxGeometry(0.96, 0.1, 0.9).translate(0, PLANK_TOP - 0.05, 0);
const mudGeo = new BoxGeometry(1, 0.2, 1).translate(0, MUD_TOP - 0.1, 0);
const springGeo = new CylinderGeometry(0.4, 0.44, 0.05, 16).translate(0, PLANK_TOP + 0.025, 0);
const springRingGeo = new RingGeometry(0.5, 0.62, 24).rotateX(-Math.PI / 2);
const markerGeo = new RingGeometry(0.5, 0.6, 4, 1).rotateX(-Math.PI / 2).rotateY(Math.PI / 4);
const pitGeo = new BoxGeometry(3, 0.3, 3).translate(0, -0.16, 0);
const bodyGeo = new SphereGeometry(1, 14, 10);
const toothGeo = new ConeGeometry(0.07, 0.22, 4);
const eyeGeo = new SphereGeometry(0.12, 8, 6);
const stalkGeo = new CylinderGeometry(0.035, 0.05, 1, 6).translate(0, 0.5, 0);
const bulbGeo = new SphereGeometry(0.22, 12, 10);

/** Local indices of the plank and the shallows tiles (the maw excluded). */
export const PLANK_TILES: readonly number[] = Array.from({ length: LANTERN_CELLS }, (_, i) => i).filter((i) => LANTERN_STANDABLE[i] && LANTERN_PLANK[i]);
export const SHALLOW_TILES: readonly number[] = Array.from({ length: LANTERN_CELLS }, (_, i) => i).filter((i) => LANTERN_STANDABLE[i] && !LANTERN_PLANK[i]);

function instanced(geo: BufferGeometry, tiles: readonly number[], color: (i: number, c: Color) => void, material: MeshStandardMaterial, name: string): InstancedMesh {
  const mesh = new InstancedMesh(geo, material, tiles.length);
  const m = new Matrix4(), c = new Color();
  tiles.forEach((i, k) => {
    const [x, , z] = tileToWorld(lanternTile(i));
    mesh.setMatrixAt(k, m.makeTranslation(x, 0, z));
    color(i, c);
    mesh.setColorAt(k, c);
  });
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.userData.worldSurface = true;
  return mesh;
}

// ---- Scene parts ---------------------------------------------------------------------------------------------------

function LanternAtmosphere() {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = { bg: scene.background, fog: scene.fog };
    const mine = { bg: new Color(BG), fog: new Fog(BG, 45, 90) };
    scene.background = mine.bg;
    scene.fog = mine.fog;
    // Restore only while ours is still attached (the overworld's may already be back on the way out).
    return () => {
      if (scene.background === mine.bg) scene.background = prev.bg;
      if (scene.fog === mine.fog) scene.fog = prev.fog;
    };
  }, [scene]);
  return <>
    <hemisphereLight args={['#9fc7a8', '#14201a', 0.7 * Math.PI]} />
    <directionalLight position={[CX + 6, 14, CZ + 9]} intensity={0.75 * Math.PI} color="#d8f0d0" />
    <pointLight position={[CX, 3.4, CZ + 0.6]} intensity={12} distance={14} decay={2} color="#ffe08a" />
  </>;
}

function LanternFloor() {
  const { setTarget } = useGameActions();
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const marker = useRef<Mesh>(null);
  const clickedAt = useRef(-Infinity);
  const { planks, mud, mats } = useMemo(() => {
    const mats = { wood: new MeshStandardMaterial({ roughness: 0.85, flatShading: true }), mud: new MeshStandardMaterial({ roughness: 1, flatShading: true }) };
    const planks = instanced(plankGeo, PLANK_TILES, (i, c) => { c.set(i % 2 ? WOOD : WOOD_DARK); }, mats.wood, 'lantern_planks');
    const mud = instanced(mudGeo, SHALLOW_TILES, (i, c) => { c.set(MUD); if (i % 3 === 0) c.multiplyScalar(1.12); }, mats.mud, 'lantern_mud');
    return { planks, mud, mats };
  }, []);
  useEffect(() => () => { planks.dispose(); mud.dispose(); mats.wood.dispose(); mats.mud.dispose(); }, [planks, mud, mats]);

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
    handleLanternFloorClick(e, {
      setTarget,
      menuNear: (x, y, radius, native) => openMenuNear(scene, camera, gl.domElement.getBoundingClientRect(), x, y, radius, native as Event),
      mark: (tile) => {
        const [wx, , wz] = tileToWorld(tile);
        marker.current?.position.set(wx, PLANK_TOP + 0.03, wz);
        clickedAt.current = performance.now();
      },
    });
  };

  return <>
    <primitive object={planks} onClick={onClick} />
    <primitive object={mud} onClick={onClick} />
    {/* The maw: a dark pit under the angler. */}
    <mesh geometry={pitGeo} position={[CX, 0, CZ]} raycast={() => null}><meshStandardMaterial color="#0d120c" roughness={1} /></mesh>
    {/* The bog around the floor. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[CX, -0.35, CZ]} raycast={() => null}>
      <circleGeometry args={[80, 32]} /><meshBasicMaterial color="#13221c" />
    </mesh>
    <mesh ref={marker} visible={false} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
      <ringGeometry args={[0.28, 0.36, 24]} /><meshBasicMaterial color="#e8ffe0" transparent depthWrite={false} toneMapped={false} />
    </mesh>
  </>;
}

/** Murky water over the shallows: it rises over every non-plank tile while the tide is in. */
function LanternWater({ flooded }: { flooded: boolean }) {
  const ref = useRef<Mesh>(null);
  const target = useRef(flooded);
  target.current = flooded;
  const mat = useMemo(() => new MeshStandardMaterial({ color: '#2f5a4a', roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: false }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame((_, dt) => {
    const m = ref.current;
    if (!m) return;
    const goal = target.current ? WATER_HIGH : WATER_LOW;
    m.position.y += (goal - m.position.y) * Math.min(1, dt * 4);
    mat.color.set(target.current ? '#3a7a62' : '#2f5a4a');
    mat.opacity = target.current ? 0.82 : 0.6;
  });
  return <mesh ref={ref} name="lantern-water" material={mat} rotation={[-Math.PI / 2, 0, 0]} position={[CX, flooded ? WATER_HIGH : WATER_LOW, CZ]} raycast={() => null} renderOrder={1}>
    <planeGeometry args={[SIZE, SIZE]} />
  </mesh>;
}

/** The four glow springs; the published one pulses with a ring and a countdown label from the dive on. */
function LanternSprings({ spring, surfacesIn, choked }: { spring: number; surfacesIn: number | null; choked: boolean }) {
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const mats = useMemo(() => LANTERN_SPRINGS.map(() => new MeshBasicMaterial({ color: SPRING_COLOR, toneMapped: false })), []);
  const ring = useMemo(() => new MeshBasicMaterial({ color: '#c8fff0', toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false }), []);
  useEffect(() => () => { for (const m of mats) m.dispose(); ring.dispose(); }, [mats, ring]);
  const live = useRef(spring);
  live.current = spring;
  useFrame(({ clock }) => {
    const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
    mats.forEach((m, k) => m.color.set(SPRING_COLOR).multiplyScalar(k === live.current ? 1.2 + pulse * 0.6 : 0.55));
    ring.opacity = 0.5 + pulse * 0.4;
  });
  return <>
    {LANTERN_SPRINGS.map((i, k) => {
      const [x, , z] = tileToWorld(lanternTile(i));
      return <group key={k} position={[x, 0, z]}>
        <mesh geometry={springGeo} material={mats[k]} raycast={() => null} />
        {k === spring && <mesh geometry={springRingGeo} material={ring} position={[0, PLANK_TOP + 0.06, 0]} raycast={() => null} renderOrder={4} name="lantern-spring-ring" />}
        {k === spring && <Html center position={[0, 1.4, 0]} zIndexRange={[3, 0]} style={{ pointerEvents: 'none' }}>
          <div className="lantern-spring-label" data-testid="lantern-spring-label">
            {surfacesIn !== null ? `Surfaces in ${Math.ceil(surfacesIn)} s` : choked ? 'Choked!' : 'Feeding'}
          </div>
        </Html>}
      </group>;
    })}
  </>;
}

/**
 * The angler: a big dark body in the maw with a row of teeth, two pale eyes and a stalk that sways a glowing lure.
 * It sinks during the dive, rises at the spring for the tide (red-lit and shuddering while choked) and is gone in the ebb.
 */
function Angler({ stage, spring, choked }: { stage: number; spring: number; choked: boolean }) {
  const root = useRef<Group>(null);
  const stalk = useRef<Group>(null);
  const reduced = useSettingsStore((s) => s.reduceMotion);
  const mats = useMemo(() => ({
    body: new MeshStandardMaterial({ color: '#2d3a24', roughness: 0.7, flatShading: true }),
    belly: new MeshStandardMaterial({ color: '#4b5a34', roughness: 0.8, flatShading: true }),
    tooth: new MeshStandardMaterial({ color: '#e8e2c8', roughness: 0.5, flatShading: true }),
    eye: new MeshBasicMaterial({ color: '#f4f0a0', toneMapped: false }),
    bulb: new MeshBasicMaterial({ color: '#ffe48a', toneMapped: false }),
  }), []);
  useEffect(() => () => { for (const m of Object.values(mats)) m.dispose(); }, [mats]);
  const live = useRef({ stage, spring, choked });
  live.current = { stage, spring, choked };
  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    const { stage: st, spring: sp, choked: ch } = live.current;
    const t = clock.elapsedTime;
    // At the tide the head rises just outside the spring (diagonally away from the maw) and faces it.
    const spring = sp >= 0 ? tileToWorld(lanternTile(LANTERN_SPRINGS[sp])) : [CX, 0, CZ];
    const out = [Math.sign(spring[0] - CX) * 1.3, Math.sign(spring[2] - CZ) * 1.3];
    const at = st === LanternStage.Tide && sp >= 0 ? [spring[0] + out[0], 0, spring[2] + out[1]] : [CX, 0, CZ];
    g.rotation.y = st === LanternStage.Tide && sp >= 0 ? Math.atan2(-out[0], -out[1]) : 0;
    const y = st === LanternStage.Den ? 0.25 : st === LanternStage.Tide ? 0 : -2.6;
    const k = Math.min(1, dt * (st === LanternStage.Tide ? 6 : 3));
    // Teleport under the mud between the maw and the spring, then rise.
    if (Math.hypot(g.position.x - at[0], g.position.z - at[2]) > 0.5 && g.position.y < -1.5) g.position.set(at[0], -2.6, at[2]);
    else { g.position.x += (at[0] - g.position.x) * k; g.position.z += (at[2] - g.position.z) * k; }
    g.position.y += (y - g.position.y) * k;
    g.scale.setScalar(st === LanternStage.Tide ? 0.6 : 1);
    g.visible = g.position.y > -2.4;
    if (!reduced && ch) g.rotation.z = Math.sin(t * 30) * 0.04; else g.rotation.z = 0;
    if (stalk.current) stalk.current.rotation.z = reduced ? 0.25 : 0.25 + Math.sin(t * 1.4) * 0.35;
    // Tipped forward so the lure dangles over the mouth.
    if (stalk.current) stalk.current.rotation.x = reduced ? 0.55 : 0.55 + Math.cos(t * 1.1) * 0.15;
    mats.bulb.color.set(ch ? '#ff6a4a' : '#ffe48a').multiplyScalar(reduced ? 1.2 : 1.1 + Math.sin(t * 3) * 0.25);
  });
  return <group ref={root} name="lanternmaw" position={[CX, 0.25, CZ]}>
    <mesh geometry={bodyGeo} material={mats.body} scale={[1.45, 0.85, 1.25]} position={[0, 0.55, -0.15]} raycast={() => null} castShadow />
    <mesh geometry={bodyGeo} material={mats.belly} scale={[1.3, 0.45, 1.0]} position={[0, 0.2, 0.25]} raycast={() => null} />
    {[-0.75, -0.45, -0.15, 0.15, 0.45, 0.75].map((x, i) => (
      <mesh key={i} geometry={toothGeo} material={mats.tooth} position={[x, 0.52, 1.02 - Math.abs(x) * 0.25]} rotation={[Math.PI, 0, 0]} raycast={() => null} />
    ))}
    {[-0.55, 0.55].map((x, i) => <mesh key={i} geometry={eyeGeo} material={mats.eye} position={[x, 1.05, 0.55]} raycast={() => null} />)}
    <group ref={stalk} position={[0, 1.3, 0.2]}>
      <mesh geometry={stalkGeo} material={mats.body} scale={[1, 1.5, 1]} raycast={() => null} />
      <mesh geometry={bulbGeo} material={mats.bulb} position={[0, 1.55, 0]} raycast={() => null} name="lanternmaw-lure" />
    </group>
  </group>;
}

/** The danger overlay and your true tile, recomputed when the tick changes (never per frame). */
export function LanternOverlay() {
  const tick = useTick();
  const me = useMyPlayer();
  const fight = useBossStore((s) => s.lanternFight);
  const run = useBossStore((s) => s.myLanternRun);
  const startTick = run?.startTick ?? 0;
  const danger = useMemo(() => lanternDanger(fight, tick, startTick), [fight, tick, startTick]);
  return <>
    <DangerTiles tiles={danger.amber} color="#ffb547" opacity={0.22} y={HAZARD_Y - 0.004} />
    <DangerTiles tiles={danger.red} color="#ff4d5e" opacity={0.45} stripes y={HAZARD_Y} />
    {me && <mesh geometry={markerGeo} position={[me.x - TILE_ORIGIN, HAZARD_Y + 0.01, me.z - TILE_ORIGIN]} raycast={() => null} renderOrder={4}>
      <meshBasicMaterial color="#5ff0ff" toneMapped={false} transparent opacity={0.9} depthWrite={false} fog={false} />
    </mesh>}
  </>;
}

export default function LanternScene(_props: LanternSceneProps) {
  const tick = useTick();
  const fight = useBossStore((s) => s.lanternFight);
  const status = lanternStatus(fight, tick);
  return <group name="lantern-scene">
    <LanternAtmosphere />
    <LanternFloor />
    <LanternWater flooded={status.flooded} />
    <LanternSprings spring={status.spring} surfacesIn={status.surfacesIn} choked={status.choked} />
    <Angler stage={fight?.stage ?? LanternStage.Den} spring={status.spring} choked={status.choked} />
    <LanternOverlay />
  </group>;
}
