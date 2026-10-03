import { homeCoastTexture } from "../frontier/homeCoast";
import { useFrontier } from "../frontier/useFrontier";
import { useFrame, useThree } from '@react-three/fiber';
import { MOUSE_TAP_RADIUS, TOUCH_TAP_RADIUS, holdState, openMenuNear } from '../Components/3D/tapAssist';
import { PlaneGeometry, ShaderMaterial, Vector2, UniformsLib, UniformsUtils } from 'three';
import { envTime } from '../Components/3D/envArt';
import { terrainGeometry, terrainMaterial, coastTexture } from '../Components/3D/islandTerrainArt';
import IslandLandmarks from '../Components/3D/IslandLandmarks';
import React, { useRef } from 'react';
import { BOULDER_KEY_ITEM, BOULDER_MESSAGE, BRAMBLE_MESSAGE, GRID_SIZE, SAFE_RADIUS, STICK_ITEM_ID, areaOf, holdsItem, isLandTile, worldToTile, tileToWorld } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyPlayer } from '../spacetime/hooks';
import { useToastStore } from '../spacetime/stores/toastStore';
import { slotsFromRows } from '../Components/itemUi';
import { useUserInputStore } from '../store';

const oceanGeo = new PlaneGeometry(400, 400);
const oceanMat = new ShaderMaterial({
  fog: true,
  uniforms: UniformsUtils.merge([UniformsLib.fog, { uTime: { value: 0 }, uCoast: { value: coastTexture }, uMapOrigin: {value:new Vector2(-.5,-.5)}, uMapSize: {value:new Vector2(64,64)} }]),
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
homeOceanMat.uniforms.uMapOrigin.value=new Vector2(-.5,-39.5);
homeOceanMat.uniforms.uMapSize.value=new Vector2(192,128);
/** The ocean plane, shaded around the island and the Boulders. */
export const Ocean = ({connected=false}:{connected?:boolean}) => <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.34, 0]} geometry={oceanGeo} material={connected?homeOceanMat:oceanMat} />;

/** The terrain exactly covers the server grid; its coastline never hides walkable tiles. */
const GroundPlane = () => {
  const { setTarget, frontier } = useGameActions();
  const me = useMyPlayer();
  const expansion = useFrontier();
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
    <mesh name="land_mesh" onClick={onClick} geometry={terrainGeometry} material={terrainMaterial} />
    <IslandLandmarks onGroundClick={onClick} />
    <Ocean connected={expansion.enabled} />
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
