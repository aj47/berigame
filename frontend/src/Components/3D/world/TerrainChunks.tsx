import React, { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { BufferGeometry } from 'three';
import { terrainMaterial } from '../islandTerrainArt';
import { KEEP_MARGIN, VIEW_RADIUS, chunksNear, type ChunkRef } from './chunks';
import { TERRAIN_COARSE_STEP, TERRAIN_FINE_STEP, cachedTerrainChunk, ensureTerrainChunk, pruneTerrainCache, terrainCacheKey } from './terrainGeometry';
import { useViewCell } from './viewCell';

export interface TerrainPlanEntry extends ChunkRef { step: number }
/** The chunks to show from a view cell and their resolution: half-tile near you, one tile further out. */
export function terrainPlan(cell: string | null): TerrainPlanEntry[] {
  return chunksNear(cell, VIEW_RADIUS.terrain).map(c => ({ ...c, step: cell !== null && c.dist > VIEW_RADIUS.terrainFine ? TERRAIN_COARSE_STEP : TERRAIN_FINE_STEP }));
}
/** Cache keys worth keeping for a view cell: the plan, plus either resolution of any chunk inside the keep margin. */
export function terrainKeep(cell: string | null): Set<string> {
  const keep = new Set<string>();
  for (const c of chunksNear(cell, VIEW_RADIUS.terrain + KEEP_MARGIN)) {
    if (c.dist <= VIEW_RADIUS.terrainFine + KEEP_MARGIN) keep.add(terrainCacheKey(c.key, TERRAIN_FINE_STEP));
    if (cell !== null && c.dist > VIEW_RADIUS.terrainFine - KEEP_MARGIN) keep.add(terrainCacheKey(c.key, TERRAIN_COARSE_STEP));
  }
  return keep;
}
/** Milliseconds of chunk building per frame (always at least one chunk). */
const BUILD_BUDGET_MS = 6;

/**
 * The ground, chunked (world/terrainGeometry.ts). Chunks are built lazily,
 * nearest first, a few milliseconds per frame, cached across remounts and
 * freed once well out of range. Until a chunk's preferred resolution is
 * built, its other one (if cached) stands in.
 */
export default function TerrainChunks({ onClick }: { onClick?: (e: any) => void }) {
  const cell = useViewCell();
  const plan = useMemo(() => terrainPlan(cell), [cell]);
  const [, setBuilt] = useState(0);
  useEffect(() => { pruneTerrainCache(terrainKeep(cell)); }, [cell]);
  useFrame(() => {
    const start = performance.now();
    let built = 0;
    for (const c of plan) {
      if (cachedTerrainChunk(c.key, c.step) !== undefined) continue;
      // At least one chunk a frame (the nearest missing one, so the one under you comes first).
      if (built > 0 && performance.now() - start > BUILD_BUDGET_MS) break;
      ensureTerrainChunk(c.cx, c.cz, c.step);
      built++;
    }
    if (built) setBuilt(n => n + 1);
  });
  return <group name="terrain_chunks">
    {plan.map(c => {
      const other = c.step === TERRAIN_FINE_STEP ? TERRAIN_COARSE_STEP : TERRAIN_FINE_STEP;
      const geometry: BufferGeometry | null | undefined = cachedTerrainChunk(c.key, c.step) ?? cachedTerrainChunk(c.key, other);
      return geometry ? <mesh key={c.key} name="land_mesh" geometry={geometry} material={terrainMaterial} onClick={onClick} dispose={null} /> : null;
    })}
  </group>;
}
