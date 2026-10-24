import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { ConeGeometry, IcosahedronGeometry, InstancedBufferAttribute, MeshStandardMaterial, OctahedronGeometry, type BufferGeometry, type InstancedMesh, type Material } from 'three';
import { merged, part, withWind } from './envArt';
import { VIEW_RADIUS, chunksNear } from './world/chunks';
import { useViewCell } from './world/viewCell';
import { SCATTER_KINDS, joinLists, scatterChunk, type ScatterKind } from './world/scatterChunks';
import { cactusGeo, dryTuftGeo, dryTuftMat, reedGeo, reedMat, shardGeo, shardMat, snowTuftGeo, staticMat } from './world/scatterArt';
import { palmGeo, palmMat } from './world/treeArt';

const noRaycast = () => null;

/** A three-blade grass tuft, vertex-coloured darker at the root. */
const tuftGeo = merged([0, 1, 2].map((i) => part(new ConeGeometry(.35, 1, 3).translate(0, .5, 0), i === 1 ? 0x5fa23c : 0x3f7f2e, [(i - 1) * .22, 0, (i % 2) * .12], [1, i === 1 ? 1.15 : .85, 1], [0, i * 1.1, (i - 1) * .35], .2, i)));
/** A flower: one bright blossom on a short stem. */
const flowerGeo = merged([
  part(new ConeGeometry(.12, 1, 3).translate(0, .5, 0), 0x4d8a3c, [0, 0, 0], [1, 1, 1], [0, 0, 0], 0, 1),
  part(new OctahedronGeometry(.42, 0), 0xffffff, [0, 1.05, 0], [1, .6, 1], [0, .4, 0], .1, 2),
  part(new IcosahedronGeometry(.16, 0), 0xffe07a, [0, 1.25, 0], [1, 1, 1], [0, 0, 0], 0, 3),
]);
const grassMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), .08, 0);
const flowerMat = withWind(new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .8 }), .05, 0);
const stoneMat = new MeshStandardMaterial({ color: '#b3aa8c', flatShading: true, roughness: 1 });
const stoneGeo = new IcosahedronGeometry(1, 0);
export {
  tuftGeo as islandGrassGeometry, grassMat as islandGrassMaterial,
  flowerGeo as islandFlowerGeometry, flowerMat as islandFlowerMaterial,
  stoneGeo as islandStoneGeometry, stoneMat as islandStoneMaterial,
};
const ART: Record<ScatterKind, [BufferGeometry, Material]> = {
  tuft: [tuftGeo, grassMat], dryTuft: [dryTuftGeo, dryTuftMat], snowTuft: [snowTuftGeo, grassMat], reed: [reedGeo, reedMat],
  cactus: [cactusGeo, staticMat], shard: [shardGeo, shardMat], stone: [stoneGeo, stoneMat], flower: [flowerGeo, flowerMat], palm: [palmGeo, palmMat],
};

/** One kind's instances over every visible chunk: a single draw, rebuilt only when the chunk set changes. */
const ScatterKindLayer = ({ kind, keys }: { kind: ScatterKind; keys: string }) => {
  const ref = useRef<InstancedMesh>(null);
  const list = useMemo(() => joinLists(keys ? keys.split(';').map((k) => { const [cx, cz] = k.split(',').map(Number); return scatterChunk(cx, cz)[kind]; }) : []), [kind, keys]);
  // Capacity in steps of 256 so walking about reuses the same InstancedMesh.
  const capacity = Math.max(256, Math.ceil(list.count / 256) * 256);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.instanceMatrix.array.set(list.matrices);
    mesh.count = list.count;
    mesh.instanceMatrix.needsUpdate = true;
    if (!mesh.instanceColor) mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    (mesh.instanceColor.array as Float32Array).set(list.colors!);
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [list, capacity]);
  const [geometry, material] = ART[kind];
  return list.count ? <instancedMesh key={capacity} ref={ref} args={[geometry, material, capacity]} raycast={noRaycast} /> : null;
};

/**
 * Deterministic, low ground cover, per chunk and per biome (world/scatterChunks.ts), mounted only
 * within VIEW_RADIUS.scatter of you. One instanced draw per kind; no colliders. Sway runs in the vertex shader.
 */
const IslandDetails = () => {
  const cell = useViewCell();
  const keys = useMemo(() => chunksNear(cell, VIEW_RADIUS.scatter).map((c) => c.key).sort().join(';'), [cell]);
  return <group name="ground_cover">{SCATTER_KINDS.map((kind) => <ScatterKindLayer key={kind} kind={kind} keys={keys} />)}</group>;
};
export default IslandDetails;
