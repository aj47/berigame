import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import type { Camera, Scene, WebGLRenderer } from 'three';

type Hook = (renderer: WebGLRenderer, camera: Camera) => void;
const hooks = new WeakMap<Scene, Set<{ current: Hook }>>();

/**
 * Run `hook` inside every render of the scene, after three.js has updated every
 * world matrix (and the camera's) and before it projects and uploads objects.
 * useFrame runs before those updates, in mount order, so anything that follows
 * an avatar group from there can lag its group by a frame; this cannot.
 */
export function useBeforeRender(hook: Hook): void {
  const scene = useThree((state) => state.scene);
  const ref = useRef(hook);
  ref.current = hook;
  useEffect(() => {
    let set = hooks.get(scene);
    if (!set) {
      const own = new Set<{ current: Hook }>();
      const previous = scene.onBeforeRender;
      scene.onBeforeRender = function (renderer, s, camera, target) {
        previous.call(this, renderer, s, camera, target);
        for (const entry of own) entry.current(renderer, camera);
      };
      hooks.set(scene, own);
      set = own;
    }
    set.add(ref);
    return () => { set!.delete(ref); };
  }, [scene]);
}
