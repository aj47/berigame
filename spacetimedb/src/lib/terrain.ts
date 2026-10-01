import { isLandTile, nearestDryTile, SCENERY_BLOCKERS, tileKey, worldBlockedSet } from '../../../shared/sim';
import { clearInteractions } from './players';
import type { Ctx } from './types';

const scenery = new Set(SCENERY_BLOCKERS.map(tileKey));
/** Idempotent, data-preserving repair when a coastline or building covers an old saved position. */
export function reconcileTerrain(ctx: Ctx): void {
  let blocked: Set<number> | undefined;
  const landing = (t: { x: number; z: number }) => {
    blocked ??= worldBlockedSet(ctx.db.tree.iter());
    return nearestDryTile(t, blocked);
  };
  for (const row of ctx.db.player.iter()) {
    if (isLandTile(row) && !scenery.has(tileKey(row))) continue;
    const p = { ...row, ...landing(row) };
    clearInteractions(ctx, p);
    ctx.db.player.identity.update(p);
  }
  for (const row of ctx.db.groundItem.iter()) {
    if (isLandTile(row) && !scenery.has(tileKey(row))) continue;
    ctx.db.groundItem.id.update({ ...row, ...landing(row) });
  }
  // Active expeditions survive deployment too: keep cargo and companions on dry ground.
  for (const row of ctx.db.expedition.iter()) {
    const next = { ...row };
    let changed = false;
    for (const prefix of ['', 'moss', 'pip', 'giant', 'bait'] as const) {
      const xKey = (prefix ? `${prefix}X` : 'x') as keyof typeof row, zKey = (prefix ? `${prefix}Z` : 'z') as keyof typeof row;
      if (typeof row[xKey] !== 'number' || typeof row[zKey] !== 'number') continue;
      const at = { x: row[xKey] as number, z: row[zKey] as number };
      if (isLandTile(at) && !scenery.has(tileKey(at))) continue;
      const tile = landing(at);
      (next as any)[xKey] = tile.x; (next as any)[zKey] = tile.z; changed = true;
    }
    if (changed) ctx.db.expedition.id.update(next);
  }
}
