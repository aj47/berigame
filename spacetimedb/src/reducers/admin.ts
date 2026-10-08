import { t } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { adminPlayer as playerSnapshot, adminSnapshot as worldSnapshot, requireAdminReader } from '../lib/adminSnapshot';

/**
 * Read-only admin panel data (docs/ANALYTICS.md), returned as JSON. Owner or
 * gateway only: the Worker calls these for its ADMIN_TOKEN /api/admin routes.
 * Each runs one short read transaction and writes nothing.
 */
export const adminSnapshot = spacetimedb.procedure(
  { name: 'admin_snapshot' },
  { days: t.u32() },
  t.string(),
  (ctx, { days }) => ctx.withTx((tx) => {
    requireAdminReader(tx);
    return JSON.stringify(worldSnapshot(tx, days));
  }),
);

export const adminPlayer = spacetimedb.procedure(
  { name: 'admin_player' },
  { identity: t.identity() },
  t.string(),
  (ctx, { identity }) => ctx.withTx((tx) => {
    requireAdminReader(tx);
    return JSON.stringify(playerSnapshot(tx, identity));
  }),
);
