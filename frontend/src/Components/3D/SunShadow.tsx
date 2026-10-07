import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Box3, Vector3, type DirectionalLight, type Material, type Mesh, type Object3D } from 'three';

/** Shadow map texels per side: 2 to 4 cm each over the area around the camera. */
const MAP_SIZE = 2048;
/** Half the shadow box's side: the camera's distance to its focus times SPAN, in HALF_STEP steps. */
const SPAN = 1.25, MIN_HALF = 14, MAX_HALF = 40, HALF_STEP = 4;
/** The light sits this far up the sun's direction from the focus; the depth range covers tall casters. */
const LIGHT_DISTANCE = 60;
/** Shaded ground keeps 40% of the sun, so shadows stay as soft as the painted art. */
const SHADOW_INTENSITY = 0.6;
/** Classify meshes added since the last pass this often (frames). */
const POLICY_EVERY = 30;

const LIT = new Set(['MeshStandardMaterial', 'MeshPhysicalMaterial', 'MeshLambertMaterial', 'MeshPhongMaterial', 'MeshToonMaterial']);
const box = new Box3();
const size = new Vector3();
const scale = new Vector3();

/** Smaller than this (largest side, world units: grass tufts, pebbles) casts nothing worth a shadow pass. */
const TINY = 0.45;

/**
 * How a mesh takes part in sun shadows, or null to leave it alone (unlit and custom
 * shaders: the sky, ocean, decals and effects). Every lit material receives, so meshes
 * sharing a material never disagree (three would switch programs between them). Flat
 * ground, tiny props, see-through surfaces and `userData.shadow === false` do not cast.
 * An instanced mesh is judged by one instance.
 */
export function shadowRole(mesh: Mesh): { cast: boolean; receive: boolean } | null {
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as Material | undefined;
  if (!material || !LIT.has(material.type)) return null;
  if (mesh.userData.shadow === false || material.transparent || !material.depthWrite) return { cast: false, receive: true };
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  box.copy(mesh.geometry.boundingBox!).getSize(size).multiply(mesh.getWorldScale(scale));
  const [x, y, z] = [Math.abs(size.x), Math.abs(size.y), Math.abs(size.z)];
  const ground = y < 0.25 && Math.max(x, z) > 3;
  const tiny = Math.max(x, y, z) < TINY;
  return { cast: !ground && !tiny, receive: true };
}

const UP = new Vector3(0, 1, 0);
const forward = new Vector3();
const focus = new Vector3();
const right = new Vector3();
const up = new Vector3();

/**
 * Real-time shadows from `light` (the sun), for the high graphics tier. The shadow box
 * follows where the camera looks and moves in whole texels so edges don't crawl as it
 * pans; it grows as the camera zooms out. Unmounting turns shadows off and frees the map.
 */
export default function SunShadow({ light }: { light: React.RefObject<DirectionalLight> }) {
  const scene = useThree((s) => s.scene);
  // The sun's direction (target to light) as authored; the light only ever moves along it.
  const direction = useRef(new Vector3());
  useEffect(() => {
    const sun = light.current;
    if (!sun) return;
    const home = sun.position.clone(), homeTarget = sun.target.position.clone();
    direction.current.copy(home).sub(homeTarget).normalize();
    const shadow = sun.shadow;
    shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03;
    shadow.radius = 3;
    shadow.intensity = SHADOW_INTENSITY;
    shadow.camera.near = 1;
    shadow.camera.far = LIGHT_DISTANCE * 2;
    scene.add(sun.target);
    sun.castShadow = true;
    return () => {
      sun.castShadow = false;
      scene.remove(sun.target);
      sun.position.copy(home);
      sun.target.position.copy(homeTarget);
      sun.target.updateMatrixWorld();
      shadow.map?.dispose();
      shadow.map = null;
    };
  }, [light, scene]);

  const classified = useMemo(() => new WeakSet<Object3D>(), []);
  const frame = useRef(0);
  useFrame(({ camera }) => {
    if (frame.current++ % POLICY_EVERY === 0) {
      scene.traverse((object) => {
        if (!(object as Mesh).isMesh || classified.has(object)) return;
        classified.add(object);
        const role = shadowRole(object as Mesh);
        if (!role) return;
        object.castShadow ||= role.cast;
        object.receiveShadow = role.receive;
      });
    }
    const sun = light.current;
    if (!sun) return;
    // Where the camera looks at the ground (y = 0).
    camera.getWorldDirection(forward);
    const along = forward.y < -0.05 ? Math.min(-camera.position.y / forward.y, 80) : 30;
    focus.copy(camera.position).addScaledVector(forward, along);
    focus.y = 0;
    const half = Math.min(MAX_HALF, Math.max(MIN_HALF, Math.ceil(camera.position.distanceTo(focus) * SPAN / HALF_STEP) * HALF_STEP));
    const shadowCamera = sun.shadow.camera;
    if (shadowCamera.right !== half) {
      shadowCamera.left = -half; shadowCamera.right = half; shadowCamera.top = half; shadowCamera.bottom = -half;
      shadowCamera.updateProjectionMatrix();
    }
    // The shadow camera's right and up axes (as lookAt builds them); snap the focus to texels on both.
    const dir = direction.current;
    right.crossVectors(UP, dir).normalize();
    up.crossVectors(dir, right);
    const texel = (2 * half) / MAP_SIZE;
    const x = Math.round(focus.dot(right) / texel) * texel, y = Math.round(focus.dot(up) / texel) * texel;
    sun.target.position.copy(right).multiplyScalar(x).addScaledVector(up, y).addScaledVector(dir, focus.dot(dir));
    sun.position.copy(sun.target.position).addScaledVector(dir, LIGHT_DISTANCE);
  });
  return null;
}
