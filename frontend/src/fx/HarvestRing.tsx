import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, PlaneGeometry, ShaderMaterial, type Mesh } from 'three';
import { estimatedTick, harvestProgress } from './harvestProgress';

const geometry = new PlaneGeometry(1, 1);

const vertexShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  // Billboard: keep the quad facing the camera, sized in world units.
  vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(modelMatrix[0].xyz);
  center.xy += position.xy * scale;
  gl_Position = projectionMatrix * center;
}`;

const fragmentShader = /* glsl */`
uniform float progress;
uniform vec3 color;
varying vec2 vUv;
const float TAU = 6.2831853;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p);
  float aa = fwidth(r) * 1.2;
  float outer = 1.0 - smoothstep(0.47 - aa, 0.47, r);
  float inner = smoothstep(0.30, 0.30 + aa, r);
  float band = outer * inner;
  // Clockwise from 12 o'clock.
  float a = atan(p.x, p.y);
  float frac = a < 0.0 ? a / TAU + 1.0 : a / TAU;
  float filled = step(frac, progress);
  vec3 track = vec3(0.10, 0.12, 0.10);
  vec3 rgb = mix(track, color, filled);
  // A light rim keeps the ring readable on grass and sand alike.
  float rim = outer * (1.0 - smoothstep(0.0, aa * 2.0, abs(r - 0.455)));
  rgb = mix(rgb, vec3(1.0), rim * 0.7);
  float alpha = band * mix(0.55, 0.95, filled) + rim * 0.4;
  float centre = 1.0 - smoothstep(0.30 - aa, 0.30, r);
  gl_FragColor = vec4(mix(rgb, vec3(0.05), centre), max(alpha, centre * 0.28));
}`;

interface Props {
  /** The harvester's harvestEndTick (0 = not harvesting). */
  endTick: number;
  /** Ticks a full harvest takes. */
  totalTicks: number;
  color?: string;
  y: number;
  size?: number;
}

/**
 * A radial progress ring floating over a tree or node while it is harvested,
 * filled clockwise from the server's harvestEndTick. One small material per
 * ring (only the handful of nodes being harvested have one); the per-frame
 * update only writes a uniform.
 */
const HarvestRing = ({ endTick, totalTicks, color = '#f4c542', y, size = 1.1 }: Props) => {
  const mesh = useRef<Mesh>(null);
  const material = useMemo(() => new ShaderMaterial({
    uniforms: { progress: { value: 0 }, color: { value: new Color(color) } },
    vertexShader, fragmentShader,
    transparent: true, depthTest: false, depthWrite: false,
    extensions: { derivatives: true } as any,
  }), []);
  React.useEffect(() => { material.uniforms.color.value.set(color); }, [color, material]);
  React.useEffect(() => () => material.dispose(), [material]);
  const shown = useRef(0);
  useFrame(() => {
    const target = harvestProgress(endTick, totalTicks, estimatedTick(performance.now()));
    // Never run backwards on tick jitter; a new harvest (target near 0) resets.
    shown.current = target < shown.current - 0.5 ? target : Math.max(shown.current, target);
    material.uniforms.progress.value = shown.current;
  });
  return <mesh ref={mesh} geometry={geometry} material={material} position={[0, y, 0]} scale={size} renderOrder={20} frustumCulled={false} raycast={() => null} />;
};

export default HarvestRing;
