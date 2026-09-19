import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { Vector3 } from 'three';
import { tileToWorld } from '@sim';

/**
 * Dev-only: lets browser automation turn a tile into screen coordinates
 * (window.__berigameProject) so it can click on players, trees and items.
 */
const DebugBridge = () => {
  const { camera, gl } = useThree();
  useEffect(() => {
    if (!(import.meta as any).env?.DEV) return;
    (window as any).__berigameProject = (tileX: number, tileZ: number, yOffset = 1) => {
      const [wx, wy, wz] = tileToWorld({ x: tileX, z: tileZ });
      const v = new Vector3(wx, wy + yOffset, wz).project(camera);
      const rect = gl.domElement.getBoundingClientRect();
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    };
    return () => { delete (window as any).__berigameProject; };
  }, [camera, gl]);
  return null;
};

export default DebugBridge;
