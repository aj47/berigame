import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3, Mesh, MeshBasicMaterial } from 'three';
import { LowPolyBuilder, linear } from '../Components/3D/nodes/lowPoly';
import { buildFenGateGeometry } from '../bosses/lantern/LanternGate';

const finite = (positions: ArrayLike<number>) => Array.from(positions).every(Number.isFinite);

describe('LowPolyBuilder.log', () => {
  it('builds finite vertices when asked for a single ring', () => {
    const b = new LowPolyBuilder();
    b.log(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0.1, 0.1, { sides: 4, rings: 1, bark: [linear(0x333333)], cap: linear(0x333333) });
    expect(finite(b.build().getAttribute('position').array)).toBe(true);
  });
});

describe('the Fen Gate', () => {
  it('has finite geometry', () => {
    const geometry = buildFenGateGeometry();
    expect(finite(geometry.getAttribute('position').array)).toBe(true);
    geometry.computeBoundingSphere();
    expect(Number.isFinite(geometry.boundingSphere!.radius)).toBe(true);
  });

  it('does not catch a ray that passes far away from it', () => {
    const mesh = new Mesh(buildFenGateGeometry(), new MeshBasicMaterial());
    mesh.position.set(22, 0, 127);
    mesh.updateMatrixWorld();
    const ray = new Raycaster(new Vector3(0, 12, 15), new Vector3(0, -1, -0.5).normalize());
    expect(ray.intersectObject(mesh)).toHaveLength(0);
  });
});
