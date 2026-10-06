import { useEffect, useMemo } from 'react';
import {
  DataTexture, DynamicDrawUsage, InstancedMesh, Matrix4, MeshBasicMaterial, PlaneGeometry, RepeatWrapping, RGBAFormat,
} from 'three';
import { GRID_SIZE, TILE_ORIGIN } from '@sim';

export interface DangerTilesProps {
  /** Tile keys (z * GRID_SIZE + x). */
  tiles: Iterable<number>;
  color: string;
  opacity: number;
  /** Diagonal stripes for colour-blind play. */
  stripes?: boolean;
  /** Quad side in tiles (default 0.94: a thin seam stays visible); smaller for dots and telegraph rays. */
  size?: number;
  /** Height above the floor (default 0.03). */
  y?: number;
}

/** One quad per floor tile of a 17 x 17 box (the Spire box) at most. */
export const DANGER_CAPACITY = 289;

/** World x, z of a tile key's centre. */
export function tileKeyCentre(key: number): [number, number] {
  return [(key % GRID_SIZE) - TILE_ORIGIN, Math.floor(key / GRID_SIZE) - TILE_ORIGIN];
}

let stripeTexture: DataTexture | null = null;
/** Diagonal stripes as an alpha map (green channel), built once without a canvas. */
function stripes(): DataTexture {
  if (stripeTexture) return stripeTexture;
  const n = 16, data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = (x + y) % 8 < 4 ? 255 : 90, o = (y * n + x) * 4;
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
  }
  stripeTexture = new DataTexture(data, n, n, RGBAFormat);
  stripeTexture.wrapS = stripeTexture.wrapT = RepeatWrapping;
  stripeTexture.needsUpdate = true;
  return stripeTexture;
}

const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const m = new Matrix4();

/** One flat quad per tile key (at most DANGER_CAPACITY), uploading only the instances in use. Returns the count. */
export function writeDangerInstances(mesh: InstancedMesh, tiles: Iterable<number>, size = 0.94, y = 0.03): number {
  let count = 0;
  for (const key of tiles) {
    if (count >= DANGER_CAPACITY) break;
    const [x, z] = tileKeyCentre(key);
    m.makeScale(size, 1, size).setPosition(x, y, z);
    mesh.setMatrixAt(count++, m);
  }
  mesh.count = count;
  if (count > 0) {
    mesh.instanceMatrix.updateRange.offset = 0;
    mesh.instanceMatrix.updateRange.count = count * 16;
    mesh.instanceMatrix.needsUpdate = true;
  }
  return count;
}

/**
 * Flat instanced quads over danger tiles (capacity 289, y 0.03, no depth
 * write, never raycast): Spire overlay and Clatterhorn telegraphs. Instances
 * are rewritten only when `tiles` changes (once per server tick), never per frame.
 */
export default function DangerTiles({ tiles, color, opacity, stripes: striped = false, size = 0.94, y = 0.03 }: DangerTilesProps) {
  const mesh = useMemo(() => {
    const material = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false });
    const im = new InstancedMesh(plane, material, DANGER_CAPACITY);
    im.instanceMatrix.setUsage(DynamicDrawUsage);
    im.count = 0;
    im.frustumCulled = false;
    im.raycast = () => {};
    im.renderOrder = 2;
    im.name = 'DangerTiles';
    return im;
  }, []);
  useEffect(() => () => { (mesh.material as MeshBasicMaterial).dispose(); mesh.dispose(); }, [mesh]);

  useEffect(() => {
    const material = mesh.material as MeshBasicMaterial;
    material.color.set(color);
    material.opacity = opacity;
    const map = striped ? stripes() : null;
    if (material.alphaMap !== map) { material.alphaMap = map; material.needsUpdate = true; }
  }, [mesh, color, opacity, striped]);

  useEffect(() => { writeDangerInstances(mesh, tiles, size, y); }, [mesh, tiles, size, y]);

  return <primitive object={mesh} />;
}
