import { useCallback, useSyncExternalStore } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import { tables, type DbConnection } from '../module_bindings';
import type { Player } from '../module_bindings/types';
import { worldBlockedSet } from '@sim';
import { identityHex } from './identity';

/*
 * Shared table snapshots. The connection already subscribes to every table
 * (connection.ts), so a hook only needs the client cache. The SDK's useTable
 * would open one more SQL subscription and copy the whole table once per
 * calling component on every transaction; here each table has one set of
 * cache callbacks and one snapshot per transaction, shared by every caller.
 */
const EMPTY: readonly any[] = Object.freeze([]);

interface TableStore {
  rows: readonly any[];
  dirty: boolean;
  listeners: Set<() => void>;
  detach: (() => void) | null;
}

const stores = new WeakMap<object, Map<string, TableStore>>();

function tableStore(connection: any, accessor: string): TableStore {
  let byTable = stores.get(connection);
  if (!byTable) { byTable = new Map(); stores.set(connection, byTable); }
  let store = byTable.get(accessor);
  if (!store) {
    store = { rows: EMPTY, dirty: true, listeners: new Set(), detach: null };
    byTable.set(accessor, store);
  }
  return store;
}

function attach(connection: any, accessor: string, store: TableStore): void {
  const table = connection?.db?.[accessor];
  if (!table || store.detach) return;
  let lastEvent: unknown;
  // One notification per transaction; the snapshot is rebuilt lazily on read.
  const changed = (ctx: any) => {
    const id = ctx?.event?.id;
    store.dirty = true;
    if (id !== undefined && id === lastEvent) return;
    lastEvent = id;
    for (const listener of [...store.listeners]) listener();
  };
  const onUpdate = (ctx: any) => changed(ctx);
  table.onInsert(changed);
  table.onDelete(changed);
  table.onUpdate?.(onUpdate);
  store.dirty = true;
  store.detach = () => {
    table.removeOnInsert(changed);
    table.removeOnDelete(changed);
    table.removeOnUpdate?.(onUpdate);
  };
}

function readRows(connection: any, accessor: string, store: TableStore): readonly any[] {
  const table = connection?.db?.[accessor];
  if (!table) return EMPTY;
  // Listen from the first read, so a cached snapshot is never stale.
  attach(connection, accessor, store);
  if (store.dirty) {
    store.rows = Array.from(table.iter());
    store.dirty = false;
  }
  return store.rows;
}

/**
 * Rows of `table`, optionally narrowed by `select`. A component re-renders only
 * when the selected value changes (Object.is), so e.g. your own player row does
 * not re-render on other players' moves.
 */
function useTableSelector<T>(table: { accessorName?: string } | any, select: (rows: readonly any[]) => T): T {
  const { getConnection } = useSpacetimeDB<DbConnection>();
  const connection = getConnection() as any;
  const accessor: string = table.accessorName ?? table.table?.accessorName;
  const subscribe = useCallback((listener: () => void) => {
    if (!connection) return () => {};
    const store = tableStore(connection, accessor);
    store.listeners.add(listener);
    attach(connection, accessor, store);
    return () => {
      store.listeners.delete(listener);
      if (store.listeners.size === 0 && store.detach) { store.detach(); store.detach = null; store.dirty = true; }
    };
  }, [connection, accessor]);
  const getSnapshot = () => select(connection ? readRows(connection, accessor, tableStore(connection, accessor)) : EMPTY);
  return useSyncExternalStore(subscribe, getSnapshot);
}

const all = (rows: readonly any[]) => rows;
function useRows<T>(table: any): readonly T[] {
  return useTableSelector(table, all) as readonly T[];
}

/** A value derived from one snapshot, computed once and shared by every caller. */
function derived<T>(cache: WeakMap<readonly any[], T>, rows: readonly any[], build: (rows: readonly any[]) => T): T {
  let value = cache.get(rows);
  if (value === undefined) { value = build(rows); cache.set(rows, value); }
  return value;
}

export function useMyIdentityHex(): string | null {
  const { identity } = useSpacetimeDB<DbConnection>();
  return identity ? identityHex(identity) : null;
}

export function useWorld() {
  const rows = useRows<any>(tables.world);
  return rows[0] ?? null;
}

export function useTick(): number {
  return useWorld()?.tick ?? 0;
}

export function usePlayers(): readonly Player[] {
  return useRows<Player>(tables.player);
}

const byHexCache = new WeakMap<readonly any[], Map<string, Player>>();
const buildByHex = (rows: readonly any[]) => {
  const m = new Map<string, Player>();
  for (const p of rows) m.set(identityHex(p.identity), p);
  return m;
};

export function usePlayersByHex(): Map<string, Player> {
  const rows = usePlayers();
  return derived(byHexCache, rows, buildByHex);
}

export function useMyPlayer(): Player | null {
  const { identity } = useSpacetimeDB<DbConnection>();
  const id = identity?.__identity__;
  // Identity.isEqual also formats both operands in SDK 2.10; compare its
  // public u256 value directly instead of allocating strings for every row.
  const select = useCallback((rows: readonly any[]): Player | null => {
    if (id === undefined) return null;
    for (const p of rows) if (p.identity.__identity__ === id) return p;
    return null;
  }, [id]);
  return useTableSelector(tables.player, select);
}

/** One player's row by identity hex (null: nobody). Re-renders only when that row changes. */
export function usePlayerByHex(hex: string | null): Player | null {
  const select = useCallback((rows: readonly any[]): Player | null => (hex === null ? null : derived(byHexCache, rows, buildByHex).get(hex) ?? null), [hex]);
  return useTableSelector(tables.player, select);
}

export function useTrees() {
  return useRows<any>(tables.tree) as readonly import('../module_bindings/types').Tree[];
}

export function useGroundItems() {
  return useRows<any>(tables.groundItem) as readonly import('../module_bindings/types').GroundItem[];
}

/*
 * The tiles nodes block. Harvests and regrowth rewrite tree rows often but
 * never move them, so the set (and every avatar using it) only changes when a
 * node is added, removed or moved.
 */
const blockedCache = new WeakMap<readonly any[], Set<number>>();
let lastBlocked: { key: string; set: Set<number> } | null = null;
const buildBlocked = (rows: readonly any[]) => {
  const key = rows.map((t) => `${t.x},${t.z}`).sort().join(';');
  if (lastBlocked?.key !== key) lastBlocked = { key, set: worldBlockedSet(rows) };
  return lastBlocked.set;
};
const selectBlocked = (rows: readonly any[]) => derived(blockedCache, rows, buildBlocked);

/** worldBlockedSet of the current nodes, stable while no node moves. Shared by every avatar. */
export function useWorldBlocked(): Set<number> {
  return useTableSelector(tables.tree, selectBlocked);
}

const sortedChatCache = new WeakMap<readonly any[], readonly any[]>();
const sortChat = (rows: readonly any[]) => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function useChatMessages() {
  const rows = useRows<any>(tables.chatMessage);
  return derived(sortedChatCache, rows, sortChat) as readonly import('../module_bindings/types').ChatMessage[];
}

/** Only this client's rows arrive (row-level security on the server). */
export function useInventoryRows() {
  return useRows<any>(tables.inventorySlot) as readonly import('../module_bindings/types').InventorySlot[];
}

export function useAppearanceRows() {
  return useRows<any>(tables.appearance) as readonly import('../module_bindings/types').Appearance[];
}

/** The Grove's training dummies (one row). */
export function useTrainingDummies() {
  return useRows<any>(tables.trainingDummy) as readonly import('../module_bindings/types').TrainingDummy[];
}

/** Your friends list (row-level security: only your own rows arrive). */
export function useFriendRows() {
  return useRows<any>(tables.friend) as readonly import('../module_bindings/types').Friend[];
}

/** Trades you are part of: at most one open trade and a request or two. */
export function useTradeRows() {
  return useRows<any>(tables.trade) as readonly import('../module_bindings/types').Trade[];
}

/** Your own invite code row, if you made one. */
export function useInviteCodeRows() {
  return useRows<any>(tables.inviteCode) as readonly import('../module_bindings/types').InviteCode[];
}
