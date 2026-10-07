import { BufferGeometry, Color, Float32BufferAttribute, Material, Matrix4, Euler, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { linear } from './nodes/lowPoly';

/**
 * Shared helpers for the island's environment art (trees, ground cover, sky,
 * ocean). One time uniform drives every swaying material; AlphaIsland advances
 * it once per frame, so wind costs no per-object JS work or allocations.
 */
export const envTime = { value: 0 };

/**
 * Adds a gentle vertex-shader sway. Displacement grows with local height
 * (`position.y - pivot`), so trunks and roots stay planted. Each object or
 * instance gets its own phase from its world position.
 */
export function withWind<T extends Material>(material: T, strength: number, pivot = 0): T {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uEnvTime = envTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uEnvTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 anchor = modelMatrix[3].xyz;
        #ifdef USE_INSTANCING
          anchor += instanceMatrix[3].xyz;
        #endif
        float h = max(0.0, position.y - ${pivot.toFixed(3)});
        float ph = anchor.x * 0.37 + anchor.z * 0.23;
        float gust = sin(uEnvTime * 1.3 + ph) * 0.7 + sin(uEnvTime * 2.9 + ph * 1.7) * 0.3;
        transformed.x += gust * ${strength.toFixed(4)} * h;
        transformed.z += cos(uEnvTime * 1.1 + ph) * ${(strength * 0.6).toFixed(4)} * h;
      }`);
  };
  material.customProgramCacheKey = () => `wind-${strength}-${pivot}`;
  return material;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();

/** A part of a merged low-poly prop: geometry, flat vertex colour, transform. */
export function part(geometry: BufferGeometry, hex: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0], jitter = 0, seed = 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  tmpQ.setFromEuler(new Euler(...rot));
  tmpM.compose(new Vector3(...pos), tmpQ, new Vector3(...scale));
  g.applyMatrix4(tmpM);
  const base = linear(hex);
  const count = g.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  let s = seed >>> 0;
  const c = new Color();
  for (let i = 0; i < count; i += 3) {
    s = (s * 1664525 + 1013904223) >>> 0;
    // Per-face brightness jitter gives a hand-painted, faceted feel.
    const k = 1 + ((s / 4294967296) - 0.5) * jitter;
    c.copy(base).multiplyScalar(k);
    for (let v = 0; v < 3 && i + v < count; v++) c.toArray(colors, (i + v) * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/** Merge parts into one geometry (one draw call) with recomputed flat normals. */
export function merged(parts: BufferGeometry[]) {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
