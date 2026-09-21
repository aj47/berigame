import { useFrame, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Vector3 } from 'three';
import { tileToWorld } from '@sim';
import { paletteCacheSnapshot } from '../../appearance/palette';

/**
 * Dev-only: lets browser automation turn a tile into screen coordinates
 * (window.__berigameProject) so it can click on players, trees and items.
 */
const DebugBridge = () => {
  const { camera, gl, scene } = useThree();
  useFrame(() => {
    if (!(import.meta as any).env?.DEV) return;
    (window as any).__berigameRender = {
      calls: gl.info.render.calls, triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries, textures: gl.info.memory.textures,
      pixelRatio: gl.getPixelRatio(), camera: camera.position.toArray(),
    };
  });
  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    (window as any).__berigameResources = () => {
      const materials = new Set<string>();
      scene.traverse((object: any) => {
        if (object.material) for (const material of [object.material].flat()) materials.add(material.uuid);
      });
      const palette = paletteCacheSnapshot();
      return { sceneMaterialCount: materials.size, paletteEntries: palette.entries, paletteUsers: palette.users };
    };
    (window as any).__berigameAvatars = () => {
      const avatars: unknown[] = [];
      scene.traverse((object) => { if (object.userData.berigameAvatar) avatars.push({ ...object.userData.berigameAvatar, position: object.parent?.position.toArray(), yaw: object.parent?.rotation.y }); });
      return avatars;
    };
    (window as any).__berigameProject = (tileX: number, tileZ: number, yOffset = 1) => {
      const [wx, wy, wz] = tileToWorld({ x: tileX, z: tileZ });
      const v = new Vector3(wx, wy + yOffset, wz).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    };
    return () => { delete (window as any).__berigameProject; delete (window as any).__berigameRender; delete (window as any).__berigameAvatars; delete (window as any).__berigameResources; };
  }, [camera, gl, scene]);
  return null;
};

export default DebugBridge;
