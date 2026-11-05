import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { DodecahedronGeometry, InstancedBufferAttribute, MeshStandardMaterial, type BufferGeometry, type InstancedMesh, type Material } from 'three';
import { EXPANSE_BRIDGES } from '@sim/expanse';
import { tileToWorld } from '@sim';
import { VIEW_RADIUS, chunkKeyOf, chunksNear } from './chunks';
import { ridgeChunks, treeChunks, type InstanceList } from './sceneryLayout';
import { TREE_ART, palmGeo, palmMat, type TreeStyle } from './treeArt';
import { expanseProps, type PlacedProp, type PropKind } from './expanseLayout';
import { clerkDeskGeo, gatehouseGeo, glowMat, propMat, rimStoneGeo, signpostGeo, stallGeo, stiltHutGeo, watchtowerGeo, waystoneGeo, waystoneGlowGeo } from './expanseArt';
import { useViewCell } from './viewCell';

const noRaycast = () => null;
const rockGeo = new DodecahedronGeometry(1, 0);
const rockMat = new MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });

/** One chunk's instances of one geometry: a single draw with its own bounds, so the camera culls it. */
export const ChunkInstances = ({ list, geometry, material, name }: { list: InstanceList; geometry: BufferGeometry; material: Material; name?: string }) => {
  const ref = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    mesh.instanceMatrix.array.set(list.matrices);
    mesh.instanceMatrix.needsUpdate = true;
    if (list.colors) mesh.instanceColor = new InstancedBufferAttribute(list.colors, 3);
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }, [list]);
  return <instancedMesh ref={ref} name={name} args={[geometry, material, list.count]} raycast={noRaycast} />;
};

/** Forest trunks (each biome's tree style) and the ridges' rock walls, per chunk, within VIEW_RADIUS.trees. */
export function SceneryChunks() {
  const cell = useViewCell();
  const chunks = useMemo(() => chunksNear(cell, VIEW_RADIUS.trees), [cell]);
  const trees = treeChunks(), ridges = ridgeChunks();
  return <group name="scenery_chunks">
    {chunks.map(c => {
      const byStyle = trees.get(c.key), ridge = ridges.get(c.key);
      if (!byStyle && !ridge) return null;
      return <group key={c.key}>
        {byStyle && (Object.entries(byStyle) as [TreeStyle, InstanceList][]).map(([style, list]) =>
          <ChunkInstances key={style} name={`trees_${style}`} list={list} geometry={TREE_ART[style].geometry} material={TREE_ART[style].material} />)}
        {ridge && <ChunkInstances name="ridge" list={ridge} geometry={rockGeo} material={rockMat} />}
      </group>;
    })}
  </group>;
}

const STALLS = [0xc0563c, 0x3f7fb8, 0xd9a03c, 0x6a9a4a].map(stallGeo);
const PROP_GEO: Record<Exclude<PropKind, 'stall'>, BufferGeometry> = {
  waystone: waystoneGeo, clerk: clerkDeskGeo, gatehouse: gatehouseGeo, stiltHut: stiltHutGeo, palm: palmGeo, rimStone: rimStoneGeo, watchtower: watchtowerGeo, signpost: signpostGeo,
};
const Prop = ({ p, onGroundClick }: { p: PlacedProp; onGroundClick?: (e: any) => void }) => {
  const [x, , z] = tileToWorld(p);
  const geometry = p.kind === 'stall' ? STALLS[p.variant % STALLS.length] : PROP_GEO[p.kind];
  // Clerks and waystones say what they are on hover, and a click walks you there like the drop boxes.
  const clickable = p.kind === 'clerk' || p.kind === 'waystone';
  return <group position={[x, 0, z]} rotation={[0, p.yaw, 0]} scale={p.scale}>
    {clickable
      ? <mesh name="land_mesh" userData={{ landmark: p.label }} geometry={geometry} material={propMat} onClick={onGroundClick} />
      : <mesh name={p.label} geometry={geometry} material={p.kind === 'palm' ? palmMat : propMat} raycast={noRaycast} />}
    {p.kind === 'waystone' && <mesh geometry={waystoneGlowGeo} material={glowMat} raycast={noRaycast} />}
  </group>;
};

/** The mainland's bridges, waystones, clerks' desks and town props, within VIEW_RADIUS.props. */
export function ExpanseProps({ onGroundClick, bridgeGeo, bridgeMat }: { onGroundClick?: (e: any) => void; bridgeGeo: BufferGeometry; bridgeMat: Material }) {
  const cell = useViewCell();
  const near = useMemo(() => new Set(chunksNear(cell, VIEW_RADIUS.props).map(c => c.key)), [cell]);
  const props = expanseProps();
  return <group name="expanse_props">
    {EXPANSE_BRIDGES.filter(b => near.has(chunkKeyOf(b.x, b.z))).map(b =>
      <mesh key={b.id} name="land_mesh" userData={{ landmark: b.name }} position={tileToWorld(b)} geometry={bridgeGeo} material={bridgeMat} onClick={onGroundClick} />)}
    {props.map((p, i) => near.has(p.chunk) ? <Prop key={i} p={p} onGroundClick={onGroundClick} /> : null)}
  </group>;
}
