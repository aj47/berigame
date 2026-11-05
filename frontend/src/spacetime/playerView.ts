/*
 * Characters as one row again. The server keeps a character in two tables
 * (spacetimedb/src/lib/playerStore.ts): `player` (name, vitals, combat,
 * weapon...) and, while online, `player_pos` (x, z, facing, walk target,
 * input counter), which is the only row a step rewrites. This view merges them
 * back, so code written against `player` rows keeps reading `x`, `z`,
 * `facing`, `targetX` and `targetZ` as before, live.
 *
 * A merged row is the `player` row itself while there is no `player_pos` row
 * (offline, or a connection without one), otherwise a copy with the position
 * on top. Copies are cached per (player row, player_pos row) pair, so a row
 * object stays the same until one of its two rows changes and selectors that
 * compare by identity keep working.
 *
 * Events: `insert` / `delete` follow `player` rows; `update` fires for a
 * `player` update and for every insert, update or delete of the matching
 * `player_pos` row (a step), with `prev` the merged row before it.
 *
 * Shared by the browser (hooks.ts, interestSubscription.ts), the agent gateway
 * and the load test: no imports.
 */

type Row = Record<string, any>;
type Cb = (...args: any[]) => void;
interface TableLike {
  iter(): Iterable<Row>;
  count?(): number | bigint;
  identity?: { find(id: unknown): Row | null | undefined };
  onInsert(cb: Cb): void;
  onDelete(cb: Cb): void;
  onUpdate?(cb: Cb): void;
  removeOnInsert(cb: Cb): void;
  removeOnDelete(cb: Cb): void;
  removeOnUpdate?(cb: Cb): void;
}
interface ConnLike { db: Record<string, any> }

/** The columns `player_pos` carries on top of `player`. */
export const POSITION_KEYS = ['x', 'z', 'facing', 'targetX', 'targetZ', 'lastInputTick', 'inputsThisTick'] as const;

/** `row` with `pos`'s position columns (a new object), or `row` itself without one. */
export function mergePosition<T extends Row>(row: T, pos: Row | null | undefined): T {
  if (!pos) return row;
  const out: Row = { ...row };
  for (const k of POSITION_KEYS) if (k in pos) out[k] = pos[k];
  return out as T;
}

export interface PlayerView<P extends Row = Row> {
  iter(): IterableIterator<P>;
  count(): number;
  identity: { find(id: unknown): P | undefined };
  onInsert(cb: (ctx: any, row: P) => void): void;
  onDelete(cb: (ctx: any, row: P) => void): void;
  onUpdate(cb: (ctx: any, prev: P, row: P) => void): void;
  removeOnInsert(cb: Cb): void;
  removeOnDelete(cb: Cb): void;
  removeOnUpdate(cb: Cb): void;
}

const views = new WeakMap<object, Map<TableLike, PlayerView>>();

/** A connection's player row type (the generated bindings' `Player`). */
type PlayerRowOf<C> = 0 extends (1 & C) ? any : C extends { db: { player: { iter(): Iterable<infer R> } } } ? R : Row;

/** The merged player table of a connection (one per connection and player table). */
export function playerView<C extends ConnLike>(conn: C): PlayerView<PlayerRowOf<C> & Row> {
  const player = conn.db.player as TableLike;
  let byTable = views.get(conn);
  if (!byTable) { byTable = new Map(); views.set(conn, byTable); }
  let view = byTable.get(player);
  if (!view) { view = makeView(conn, player); byTable.set(player, view); }
  return view as unknown as PlayerView<PlayerRowOf<C> & Row>;
}

function makeView(conn: ConnLike, player: TableLike): PlayerView {
  const posTable = (): TableLike | undefined => conn.db.playerPos;
  const cache = new WeakMap<Row, { pos: Row | undefined; merged: Row }>();
  const posFor = (identity: unknown): Row | undefined => posTable()?.identity?.find(identity) ?? undefined;
  const merged = (row: Row): Row => {
    const pos = posFor(row.identity);
    if (!pos) return row;
    const hit = cache.get(row);
    if (hit && hit.pos === pos) return hit.merged;
    const m = mergePosition(row, pos);
    cache.set(row, { pos, merged: m });
    return m;
  };
  const playerOf = (identity: unknown): Row | undefined => player.identity?.find(identity) ?? undefined;

  type Kind = 'insert' | 'update' | 'delete';
  /** The wrappers registered for each caller's callback (by the view event they serve), so remove* can find them. */
  const wrapped = new Map<Cb, [Kind, TableLike, Kind, Cb][]>();
  const add = (cb: Cb, serves: Kind, table: TableLike | undefined, kind: Kind, w: Cb) => {
    if (!table) return;
    if (kind === 'insert') table.onInsert(w); else if (kind === 'delete') table.onDelete(w); else table.onUpdate?.(w);
    const list = wrapped.get(cb) ?? [];
    list.push([serves, table, kind, w]);
    wrapped.set(cb, list);
  };
  const remove = (cb: Cb, serves: Kind) => {
    const list = wrapped.get(cb);
    if (!list) return;
    const keep = list.filter(([s, table, k, w]) => {
      if (s !== serves) return true;
      if (k === 'insert') table.removeOnInsert(w); else if (k === 'delete') table.removeOnDelete(w); else table.removeOnUpdate?.(w);
      return false;
    });
    if (keep.length) wrapped.set(cb, keep); else wrapped.delete(cb);
  };

  return {
    *iter() { for (const row of player.iter()) yield merged(row); },
    count: () => Number(player.count?.() ?? [...player.iter()].length),
    identity: { find: (id) => { const row = playerOf(id); return row ? merged(row) : undefined; } },
    onInsert(cb) { add(cb, 'insert', player, 'insert', (ctx: any, row?: Row) => cb(ctx, (row && merged(row)) as Row)); },
    onDelete(cb) { add(cb, 'delete', player, 'delete', (ctx: any, row?: Row) => cb(ctx, (row && mergePosition(row, posFor(row.identity))) as Row)); },
    onUpdate(cb) {
      add(cb, 'update', player, 'update', (ctx: any, prev?: Row, row?: Row) => cb(ctx, (prev && mergePosition(prev, posFor(prev.identity))) as Row, (row && merged(row)) as Row));
      const pos = posTable();
      // A step: the player row is unchanged, so `prev` is that row with the old position.
      add(cb, 'update', pos, 'update', (ctx: any, old: Row, next: Row) => {
        const row = playerOf(next.identity);
        if (row) cb(ctx, mergePosition(row, old), merged(row));
      });
      add(cb, 'update', pos, 'insert', (ctx: any, next: Row) => {
        const row = playerOf(next.identity);
        if (row) cb(ctx, row, merged(row));
      });
      add(cb, 'update', pos, 'delete', (ctx: any, old: Row) => {
        const row = playerOf(old.identity);
        if (row) cb(ctx, mergePosition(row, old), merged(row));
      });
    },
    removeOnInsert: (cb) => remove(cb, 'insert'),
    removeOnDelete: (cb) => remove(cb, 'delete'),
    removeOnUpdate: (cb) => remove(cb, 'update'),
  };
}
