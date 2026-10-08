import { homeCoastTexture } from "../frontier/homeCoast";
import { HOME_GRID, MEADOW_OFFSET } from "../../../shared/sim/frontier/homeMap";
import { useFrontierEnabled } from "../frontier/useFrontier";
import { useFrame, useThree } from '@react-three/fiber';
import { MOUSE_TAP_RADIUS, TOUCH_TAP_RADIUS, holdState, openMenuNear } from '../Components/3D/tapAssist';
import { Mesh, MeshBasicMaterial, Plane, PlaneGeometry, Raycaster, ShaderMaterial, Vector2, Vector3, UniformsLib, UniformsUtils } from 'three';
import { envTime } from '../Components/3D/envArt';
import { terrainGeometry, terrainMaterial, coastTexture } from '../Components/3D/islandTerrainArt';
import IslandLandmarks from '../Components/3D/IslandLandmarks';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  BOULDER_KEY_ITEM, BOULDER_MESSAGE, BRAMBLE_MESSAGE, GRID_SIZE, SAFE_RADIUS, STICK_ITEM_ID, areaOf, clatterSwarmFreeLines, clatterTelegraph,
  holdsItem, inClatterGlade, worldToTile, tileToWorld, type ClatterRowLike,
} from '@sim';
import { inSpire, isOpenGround } from '../bosses/selectors';
import { useBossStore } from '../bosses/bossStore';
import { clatterHoverVerdict, hoverTile, isWorldSurface } from '../Components/3D/hoverTarget';
import { useSettingsStore } from '../spacetime/stores/settingsStore';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyPlayer, useTick, useWorldBlocked } from '../spacetime/hooks';
import { useToastStore } from '../spacetime/stores/toastStore';
import { slotsFromRows } from '../Components/itemUi';
import { useUserInputStore } from '../store';

/** Wide enough for the joined districts; fog hides its edge. */
const oceanGeo = new PlaneGeometry(720, 720);
const oceanMat = new ShaderMaterial({
  fog: true,
  uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uCoast: { value: coastTexture }, uMapOrigin: {value:new Vector2(-.5,-.5)}, uMapSize: {value:new Vector2(GRID_SIZE,GRID_SIZE)} }]),
  vertexShader: `varying vec2 vW;
    #include <fog_pars_vertex>
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz;
      vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `uniform float uTime; uniform sampler2D uCoast; uniform vec2 uMapOrigin; uniform vec2 uMapSize; varying vec2 vW;
    #include <fog_pars_fragment>
    void main(){
      vec2 uv = (vW + 25.0 - uMapOrigin) / uMapSize;
      float d = texture2D(uCoast, clamp(uv, 0.0, 1.0)).r * 32.0 - 8.0;
      d += length(max(vec2(0.0), max(-uv, uv-1.0)) * uMapSize);
      float wob = sin(vW.x * 0.9 + uTime * 0.8) * 0.12 + sin(vW.y * 1.1 - uTime * 0.7) * 0.12;
      vec3 shallow = vec3(0.30, 0.80, 0.76), mid = vec3(0.05, 0.56, 0.66), deep = vec3(0.0, 0.33, 0.52);
      vec3 c = mix(shallow, mid, smoothstep(0.0, 5.0, d + wob));
      c = mix(c, deep, smoothstep(5.0, 22.0, d));
      // Stepped, low-poly glints on the open water.
      float g = sin(vW.x * 0.45 + uTime * 0.5) * sin(vW.y * 0.5 - uTime * 0.4);
      c += step(0.82, g) * 0.05;
      // Foam: a steady rim at the sand plus one travelling wave line.
      float rim = 1.0 - smoothstep(0.15, 0.55 + wob * 0.5, d);
      float wave = fract(uTime * 0.18);
      float line = (1.0 - smoothstep(0.0, 0.18, abs(d - 0.4 - wave * 2.6 + wob))) * (1.0 - wave);
      c = mix(c, vec3(0.97, 0.98, 0.94), clamp(rim + line * 0.8, 0.0, 1.0));
      gl_FragColor = vec4(c, 1.0);
      #include <fog_fragment>
    }`,
});
oceanMat.uniforms.uTime = envTime;

const homeOceanMat = oceanMat.clone();
homeOceanMat.uniforms.uTime=envTime;
homeOceanMat.uniforms.uCoast.value=homeCoastTexture;
homeOceanMat.uniforms.uMapOrigin.value=new Vector2(-.5,MEADOW_OFFSET.z-.5);
homeOceanMat.uniforms.uMapSize.value=new Vector2(HOME_GRID.width,HOME_GRID.height);
/** The ocean plane, shaded around the island and the Boulders. */
export const Ocean = ({connected=false}:{connected?:boolean}) => <mesh rotation={[-Math.PI / 2, 0, 0]} position={[100, -0.34, 40]} geometry={oceanGeo} material={connected?homeOceanMat:oceanMat} />;

/** A charge, spin or drum is telegraphed, or the swarm runs. */
export function clatterHazardLive(row: ClatterRowLike | null | undefined): boolean {
  return !!row && (clatterTelegraph(row) !== null || clatterSwarmFreeLines(row).length > 0);
}

const dodgeGeo = new PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2);
const DODGE_COLOR = { safe: '#5ff2a0', hit: '#ff4d5e' } as const;
const noRaycast = () => {};

/**
 * Clatterhorn dodge assist (Settings, default on): while you stand in the glade during a telegraph or the swarm,
 * the ground tile under the mouse is tinted green (the move is hit-free through the hazard) or red (it is hit),
 * judged by `clatterHoverVerdict` exactly as the Spire's safe-move hover judges a floor tile. The pointer is read
 * like WorldHover's (a ground plane, never the terrain mesh); mounted only while it can apply.
 */
export const ClatterDodgeHover = () => {
  const assist = useSettingsStore((s) => s.dodgeAssist);
  const me = useMyPlayer();
  const here = !!me && (me.region || 'bramblewild') === 'bramblewild' && inClatterGlade(me);
  const live = useBossStore((s) => clatterHazardLive(s.clatter));
  return assist && here && live ? <ClatterDodgeTint /> : null;
};

const ClatterDodgeTint = () => {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const connected = useThree((s) => s.events.connected);
  const me = useMyPlayer(), tick = useTick(), blocked = useWorldBlocked();
  const tint = useRef<Mesh>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const seen = useRef<{ key: string; row: unknown }>({ key: '', row: null });
  const scratch = useMemo(() => ({ ray: new Raycaster(), ndc: new Vector2(), plane: new Plane(new Vector3(0, 1, 0), 0), point: new Vector3() }), []);
  useEffect(() => {
    const canvas = gl.domElement;
    const move = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY, active: e.pointerType === 'mouse' && e.buttons === 0 && isWorldSurface(e.target, canvas, connected) };
    };
    const leave = () => { pointer.current.active = false; };
    const surface = canvas.parentElement ?? canvas;
    window.addEventListener('pointermove', move);
    window.addEventListener('blur', leave);
    surface.addEventListener('pointerleave', leave);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', leave);
      surface.removeEventListener('pointerleave', leave);
    };
  }, [gl, connected]);
  useFrame(() => {
    const m = tint.current, p = pointer.current;
    if (!m) return;
    if (!p.active || !me || holdState.active) { m.visible = false; seen.current.key = ''; return; }
    const rect = gl.domElement.getBoundingClientRect();
    scratch.ndc.set(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1);
    scratch.ray.setFromCamera(scratch.ndc, camera);
    if (!scratch.ray.ray.intersectPlane(scratch.plane, scratch.point)) { m.visible = false; return; }
    const tile = hoverTile(scratch.point.x, scratch.point.z);
    const row = useBossStore.getState().clatter;
    const key = `${tile.x},${tile.z}:${tick}:${me.x},${me.z}`;
    if (key === seen.current.key && row === seen.current.row) return;
    seen.current = { key, row };
    const v = clatterHoverVerdict(row, tick, me, tile, blocked);
    m.visible = !!v;
    if (!v) return;
    m.position.set(...tileToWorld(tile));
    m.position.y = 0.05;
    (m.material as MeshBasicMaterial).color.set(DODGE_COLOR[v.kind]);
  });
  return <mesh ref={tint} geometry={dodgeGeo} visible={false} raycast={noRaycast} renderOrder={99}>
    <meshBasicMaterial transparent opacity={0.45} depthWrite={false} toneMapped={false} />
  </mesh>;
};

/** The terrain exactly covers the server grid; its coastline never hides walkable tiles. */
const groundClick = { me: null as ReturnType<typeof useMyPlayer>, rows: [] as ReturnType<typeof useInventoryRows>, setTarget: ((_x: number, _z: number) => {}) as (x: number, z: number) => unknown, frontier: ((_c: any) => {}) as (c: any) => unknown };
const GroundClickBindings = () => {
  const { setTarget, frontier } = useGameActions();
  const me = useMyPlayer();
  const rows = useInventoryRows();
  groundClick.me = me; groundClick.rows = rows; groundClick.setTarget = setTarget; groundClick.frontier = frontier;
  return null;
};

const GroundPlane = () => {
  const expansionEnabled = useFrontierEnabled();
  const marker = useRef<any>(null);
  const clickedAt = useRef(-Infinity);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (!marker.current) return;
    const age = (performance.now() - clickedAt.current) / 850;
    // Before the first click age is Infinity. Keep hidden marker transforms
    // finite, and stop updating its matrix once the short animation finishes.
    if (age >= 1 || age < 0) {
      marker.current.visible = false;
      return;
    }
    marker.current.visible = true;
    marker.current.scale.setScalar(0.8 + age * 0.45);
    marker.current.material.opacity = Math.max(0, 1 - age);
  });
  const onClick = (e: any) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    // The release of a hold-to-walk (or a hold that opened a menu) is not a new tap.
    if (holdState.active || performance.now() < holdState.suppressClickUntil) return;
    // Bigger touch targets: a tap just beside a tree, item or adventurer selects it.
    const native = e.nativeEvent as PointerEvent | undefined;
    if (native && typeof native.clientX === 'number') {
      const radius = native.pointerType === 'mouse' ? MOUSE_TAP_RADIUS : TOUCH_TAP_RADIUS;
      if (openMenuNear(scene, camera, gl.domElement.getBoundingClientRect(), native.clientX, native.clientY, radius, native)) return;
    }
    useUserInputStore.getState().setClickedOtherObject(null);
    const { me, rows, setTarget, frontier } = groundClick;
    const tile = worldToTile(e.point.x, e.point.z);
    // From the overworld the Spire floor reads as water (no far-flood setTarget calls).
    if (tile.x < 0 || tile.z < 0 || tile.x >= GRID_SIZE || tile.z >= GRID_SIZE || !isOpenGround(tile, inSpire(me))) return;
    const [x, , z] = tileToWorld(tile);
    marker.current.position.set(x, 0.045, z);
    clickedAt.current = performance.now();
    if (me?.region === 'settlement') {
      void frontier({action:'walk', id:'bramblewild', ...tile});
      return;
    }
    setTarget(tile.x, tile.z);
    // Without a stick the server stops you at the hedge; say why.
    if (me && areaOf(me) === 'grove' && areaOf(tile) !== 'grove'
      && !holdsItem(slotsFromRows(rows), me.weapon, STICK_ITEM_ID)) {
      useToastStore.getState().show(BRAMBLE_MESSAGE);
    } else if (me && areaOf(me) !== 'boulders' && areaOf(tile) === 'boulders'
      && !holdsItem(slotsFromRows(rows), me.weapon, BOULDER_KEY_ITEM)) {
      // Without a stone club the server stops you at the boulder line.
      useToastStore.getState().show(BOULDER_MESSAGE);
    }
  };
  return <>
    <GroundClickBindings />
    <mesh name="land_mesh" onClick={onClick} geometry={terrainGeometry} material={terrainMaterial} />
    <IslandLandmarks onGroundClick={onClick} />
    <Ocean connected={expansionEnabled} />
    <ClatterDodgeHover />
    <mesh ref={marker} visible={false} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.28, 0.36, 24]} /><meshBasicMaterial color="#fff2bd" transparent depthWrite={false} />
    </mesh>
    {/* Worn paths and the gathering circle are flat, non-blocking ground details. */}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
      <circleGeometry args={[3.15, 12]} /><meshStandardMaterial color="#dcc184" roughness={1} />
    </mesh>
    {/* The safe ring (no fighting): a pale sand border around the 5x5 centre tiles. */}
    <mesh rotation={[-Math.PI / 2, 0, Math.PI / 4]} position={[0, 0.008, 0]}>
      <ringGeometry args={[(SAFE_RADIUS + 0.5) * Math.SQRT2 - 0.22, (SAFE_RADIUS + 0.5) * Math.SQRT2, 4, 1]} /><meshStandardMaterial color="#ecd9a0" roughness={1} />
    </mesh>
  </>;
};
export default GroundPlane;
