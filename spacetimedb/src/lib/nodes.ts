import { NODE_SEEDS } from '../../../shared/sim';
import { nodeCell } from '../../../shared/sim/interest';
import type { Ctx, TreeRow } from './types';

/**
 * Insert any seeded node (Coast nodes, the Long Season's tier nodes) whose id
 * is missing, move rows whose seed moved, and give every row its subscription
 * cell (shared/sim/interest.ts nodeCell; 0 on rows from before the column), so
 * an older database catches up on its next tick. Idempotent. Returns the inserted or moved rows.
 *
 * `rows` is the current tree table by id. The tick passes the map it already
 * loaded, so the ~420 seeds cost map lookups instead of primary-key finds;
 * inserted and moved rows are written back into it. Without a map the table
 * is read once.
 */
export function seedMissingNodes(ctx: Ctx, rows?: Map<number, TreeRow>): TreeRow[] {
  const existing = rows ?? new Map<number, TreeRow>(Array.from(ctx.db.tree.iter(), (t) => [t.id, t] as [number, TreeRow]));
  const out: TreeRow[] = [];
  for (const seed of NODE_SEEDS) {
    const found = existing.get(seed.id);
    if (found) {
      const cell = nodeCell(seed.x, seed.z);
      if (found.x !== seed.x || found.z !== seed.z || found.cell !== cell) {
        const moved = { ...found, x: seed.x, z: seed.z, cell };
        ctx.db.tree.id.update(moved);
        existing.set(moved.id, moved);
        out.push(moved);
      }
      continue;
    }
    const row: TreeRow = { id: seed.id, x: seed.x, z: seed.z, itemId: seed.itemId, cooldownUntilTick: 0, harvester: undefined, kind: seed.kind, cell: nodeCell(seed.x, seed.z) };
    ctx.db.tree.insert(row);
    existing.set(row.id, row);
    out.push(row);
  }
  // Rows that are no seed (the first Grove trees, TREE_SEEDS) get their cell too.
  for (const [id, row] of existing) {
    const cell = nodeCell(row.x, row.z);
    if (row.cell === cell) continue;
    const fixed = { ...row, cell };
    ctx.db.tree.id.update(fixed);
    existing.set(id, fixed);
    out.push(fixed);
  }
  return out;
}
