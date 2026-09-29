import { useFrame, useThree } from '@react-three/fiber';
import { MOUSE_TAP_RADIUS, TOUCH_TAP_RADIUS, holdState, openMenuNear } from '../Components/3D/tapAssist';
import { BoxGeometry, Color, Float32BufferAttribute, MeshStandardMaterial, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
import { envTime } from '../Components/3D/envArt';
import { linear } from '../Components/3D/nodes/lowPoly';
import React, { useRef } from 'react';
import { BOULDER_KEY_ITEM, BOULDER_MESSAGE, BRAMBLE_MESSAGE, GRID_SIZE, HEDGE_RING, ISLAND_SIZE, SAFE_RADIUS, STICK_ITEM_ID, areaOf, holdsItem, isLandTile, ringOf, worldToTile, tileToWorld } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyPlayer } from '../spacetime/hooks';
import { useToastStore } from '../spacetime/stores/toastStore';
import { slotsFromRows } from '../Components/itemUi';
import { useUserInputStore } from '../store';

/** Grass with soft, deterministic colour patches baked into vertex colours (one draw). */
const landGeo = (() => {
  const g = new PlaneGeometry(ISLAND_SIZE, ISLAND_SIZE, 25, 25);
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const light = linear(0x4e9a2e), dark = linear(0x2f7426), warm = linear(0x86a03c), c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const n = Math.sin(x * 0.31 + Math.sin(y * 0.17) * 2) * 0.5 + Math.sin(y * 0.27 - x * 0.12) * 0.5;
    const k = (n + 1) / 2;
    c.copy(dark).lerp(light, k);
    // Sun-dried, warmer grass toward the beach.
    const edge = Math.max(Math.abs(x), Math.abs(y)) / (ISLAND_SIZE / 2);
    c.lerp(warm, Math.max(0, (edge - 0.82) / 0.18) * 0.7);
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
})();
const landMat = new MeshStandardMaterial({ vertexColors: true, roughness: 1 });

/*
 * The Boulders (M3): an L of dusty volcanic ground past the old south-east
 * shoreline, as two vertex-coloured planes (tiles x 50-63 by z 36-63, and x
 * 36-49 by z 50-63). World = tile - 25, and a tile's centre is its integer
 * world coordinate, so a plane spanning tiles a..b runs from a-25.5 to b-24.5.
 */
function rockyGround(w: number, h: number, cx: number, cz: number) {
  const g = new PlaneGeometry(w, h, Math.round(w / 2), Math.round(h / 2));
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  const ash = linear(0x8a7d6b), dark = linear(0x6b5f52), moss = linear(0x7d8a4f), c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, y = -pos.getY(i) + cz;
    const n = Math.sin(x * 0.43 + Math.sin(y * 0.21) * 2.2) * 0.5 + Math.sin(y * 0.37 - x * 0.18) * 0.5;
    c.copy(dark).lerp(ash, (n + 1) / 2);
    // A little moss where the plateau meets the old Coast.
    const nearCoast = Math.max(0, 1 - (Math.min(Math.abs(x - 25), Math.abs(y - 25)) / 4));
    c.lerp(moss, nearCoast * 0.35);
    c.toArray(colors, i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}
/** [width, depth, centre x, centre z] in world units. */
const BOULDER_SLABS: [number, number, number, number][] = [[14, 28, 31.5, 24.5], [14, 14, 17.5, 31.5]];
const boulderGeos = BOULDER_SLABS.map(([w, h, cx, cz]) => rockyGround(w, h, cx, cz));
const boxGeo = new BoxGeometry(1, 1, 1);

/**
 * The ocean: one big plane whose shader shades shallow turquoise to deep blue
 * by distance from the island square, with a band of foam that laps the sand.
 * Only the shared clock uniform changes per frame.
 */
const oceanGeo = new PlaneGeometry(400, 400);
const oceanMat = new ShaderMaterial({
  fog: true,
  uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 } }]),
  vertexShader: `varying vec2 vW;
    #include <fog_pars_vertex>
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz;
      vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `uniform float uTime; varying vec2 vW;
    #include <fog_pars_fragment>
    void main(){
      vec2 p = abs(vW + 0.5);
      float d = max(p.x, p.y) - 26.0;
      // The Boulders' L (M3), with the same one-unit sand margin.
      d = min(d, max(abs(vW.x - 31.5) - 7.0, abs(vW.y - 24.5) - 14.0) - 1.0);
      d = min(d, max(abs(vW.x - 17.5) - 7.0, abs(vW.y - 31.5) - 7.0) - 1.0);
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

/** The Boulders' ground slabs and their sand shelves (M3). */
export const BouldersGround = ({ onClick }: { onClick?: (e: any) => void }) => <>
  {BOULDER_SLABS.map(([w, h, cx, cz], i) => <React.Fragment key={i}>
    <mesh name="boulders_land" rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} onClick={onClick} geometry={boulderGeos[i]} material={landMat} />
    <mesh position={[cx, -0.26, cz]} geometry={boxGeo} scale={[w + 2, 0.5, h + 2]}><meshStandardMaterial color="#cdb98f" roughness={1} /></mesh>
    <mesh position={[cx, -0.7, cz]} geometry={boxGeo} scale={[w + 4, 0.6, h + 4]}><meshStandardMaterial color="#b9a47a" roughness={1} /></mesh>
  </React.Fragment>)}
</>;

/** The ocean plane, shaded around the island and the Boulders. */
export const Ocean = () => <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} geometry={oceanGeo} material={oceanMat} />;

/** The terrain exactly covers the server grid; its coastline never hides walkable tiles. */
const GroundPlane = () => {
  const { setTarget } = useGameActions();
  const me = useMyPlayer();
  const rows = useInventoryRows();
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
    const tile = worldToTile(e.point.x, e.point.z);
    if (tile.x < 0 || tile.z < 0 || tile.x >= GRID_SIZE || tile.z >= GRID_SIZE || !isLandTile(tile)) return;
    const [x, , z] = tileToWorld(tile);
    marker.current.position.set(x, 0.045, z);
    clickedAt.current = performance.now();
    setTarget(tile.x, tile.z);
    // Without a stick the server stops you at the hedge; say why.
    if (me && ringOf(me) < HEDGE_RING && ringOf(tile) >= HEDGE_RING
      && !holdsItem(slotsFromRows(rows), me.weapon, STICK_ITEM_ID)) {
      useToastStore.getState().show(BRAMBLE_MESSAGE);
    } else if (me && areaOf(me) !== 'boulders' && areaOf(tile) === 'boulders'
      && !holdsItem(slotsFromRows(rows), me.weapon, BOULDER_KEY_ITEM)) {
      // Without a stone club the server stops you at the boulder line.
      useToastStore.getState().show(BOULDER_MESSAGE);
    }
  };
  return <>
    <mesh name="land_mesh" rotation={[-Math.PI / 2, 0, 0]} position={[-0.5, 0, -0.5]} onClick={onClick} geometry={landGeo} material={landMat} />
    {/* A sunny sand shelf and a darker wet-sand step below the waterline. */}
    <mesh position={[-0.5, -0.26, -0.5]} geometry={boxGeo} scale={[52, 0.5, 52]}><meshStandardMaterial color="#f2dc9e" roughness={1} /></mesh>
    <mesh position={[-0.5, -0.7, -0.5]} geometry={boxGeo} scale={[54, 0.6, 54]}><meshStandardMaterial color="#d6bd84" roughness={1} /></mesh>
    <BouldersGround onClick={onClick} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} geometry={oceanGeo} material={oceanMat} />
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
    {/* All four paths run from the centre to the hedge crossings at 17 tiles. */}
    {[[0, -9, 1.8, 16], [8.5, 0, 17, 1.8], [-8.5, 0, 17, 1.8], [0, 8.5, 1.8, 17]].map(([x,z,w,h],i) => <mesh key={i} rotation={[-Math.PI / 2,0,0]} position={[x,0.004,z]}>
      <planeGeometry args={[w,h]} /><meshStandardMaterial color="#cdb077" roughness={1} />
    </mesh>)}
  </>;
};
export default GroundPlane;
