import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, Mesh, ShaderMaterial, SphereGeometry, type DirectionalLight } from 'three';
import IslandDetails from './IslandDetails';
import AmbientLife from './AmbientLife';
import BrambleHedge from './BrambleHedge';
import BouldersArea from './BouldersArea';
import GroundPlane from '../../Objects/GroundPlane';
import { envTime } from './envArt';
import SunShadow from './SunShadow';
import { QUALITY, useGraphicsTier } from './renderQuality';

/** Horizon tone shared by the sky, fog and clear colour so the ocean melts into the sky. */
const HORIZON = '#cdeef0';

/** A stylised gradient sky: one low-poly dome, no texture. */
const skyGeo = new SphereGeometry(160, 16, 8);
const skyMat = new ShaderMaterial({
  side: BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying float vH; void main(){ vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `varying float vH;
    void main(){
      vec3 horizon = vec3(0.804, 0.933, 0.941);
      vec3 mid = vec3(0.494, 0.796, 0.910);
      vec3 zenith = vec3(0.235, 0.588, 0.835);
      float h = clamp(vH, 0.0, 1.0);
      vec3 c = mix(horizon, mid, smoothstep(0.0, 0.25, h));
      c = mix(c, zenith, smoothstep(0.25, 0.9, h));
      gl_FragColor = vec4(c, 1.0);
    }`,
});

/** The dome travels with the camera, so the far Meadows never leave the sky. */
const Sky = () => {
  const ref = useRef<Mesh>(null);
  useFrame(({ camera }) => { ref.current?.position.set(camera.position.x, 0, camera.position.z); });
  return <mesh ref={ref} geometry={skyGeo} material={skyMat} renderOrder={-1} raycast={() => null} frustumCulled={false} />;
};

/** Advances the one shared wind/wave clock; no allocations per frame. */
const Clock = () => { useFrame((_, dt) => { envTime.value += Math.min(dt, 0.1); }); return null; };

/** Lights, sky and the ground. Trees now come from the server's `tree` table. */
const AlphaIsland = () => {
  const sun = useRef<DirectionalLight>(null);
  const quality = QUALITY[useGraphicsTier()];
  return (
    <>
      <color attach="background" args={[HORIZON]} />
      <fog attach="fog" args={[HORIZON, 55, 150]} />
      <Sky />
      {/* Warm late-morning sun as the key, cool sky bounce as the fill. */}
      <directionalLight ref={sun} position={[-12, 24, 10]} intensity={1.0 * Math.PI} color="#ffe2b8" />
      {quality.shadows && <SunShadow light={sun} />}
      <hemisphereLight args={['#cfe8ff', '#8c7a52', 0.55 * Math.PI]} />
      <Clock />
      <GroundPlane />
      <IslandDetails />
      {quality.ambientLife && <AmbientLife />}
      <BrambleHedge />
      <BouldersArea />
    </>
  );
};

export default AlphaIsland;
