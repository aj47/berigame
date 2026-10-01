import { NODE_SEEDS } from '../../../shared/sim';
import type { Ctx, TreeRow } from './types';

/**
 * Insert any Coast node (driftwood pile, tide rock) whose id is missing, so a
 * database published before M2 gets them on its next tick. Idempotent.
 * Returns the inserted rows.
 */
export function seedMissingNodes(ctx: Ctx, has: (id: number) => boolean = (id) => !!ctx.db.tree.id.find(id)): TreeRow[] {
  const out: TreeRow[] = [];
  for (const seed of NODE_SEEDS) {
    if (has(seed.id)) {
      const existing = ctx.db.tree.id.find(seed.id);
      if (existing && (existing.x !== seed.x || existing.z !== seed.z)) {
        const moved = { ...existing, x: seed.x, z: seed.z };
        ctx.db.tree.id.update(moved);
        out.push(moved);
      }
      continue;
    }
    const row: TreeRow = { id: seed.id, x: seed.x, z: seed.z, itemId: seed.itemId, cooldownUntilTick: 0, harvester: undefined, kind: seed.kind };
    ctx.db.tree.insert(row);
    out.push(row);
  }
  return out;
}
