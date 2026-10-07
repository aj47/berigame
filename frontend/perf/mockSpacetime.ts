/** Bench-only stand-in for 'spacetimedb/react': tables served from an in-memory store. */
import { useSyncExternalStore } from 'react';
import type { Identity } from 'spacetimedb';

const EMPTY: readonly any[] = [];
const rows: Record<string, readonly any[]> = {};
const listeners = new Set<() => void>();
// Row callbacks registered by the game's table hooks (src/spacetime/hooks.ts), by table name.
const changed = new Map<string, Set<(ctx: any) => void>>();
let event = 0;
export const benchStore = {
  identity: undefined as Identity | undefined,
  set(table: string, value: readonly any[]) {
    rows[table] = value;
    for (const l of listeners) l();
    // Like the SDK: the whole transaction is applied before its row callbacks run.
    const ctx = { event: { id: ++event } };
    for (const cb of [...(changed.get(table) ?? [])]) cb(ctx);
  },
  get(table: string) { return rows[table] ?? EMPTY; },
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useTable(table: any): [readonly any[], boolean] {
  const name: string = table?.name ?? table?.tableName ?? table?.sourceName;
  return [useSyncExternalStore(subscribe, () => benchStore.get(name)), true];
}

// A client cache keyed by accessor (chatMessage -> chat_message), enough for hooks.ts.
const tableFor = (accessor: string) => {
  const name = accessor.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const callbacks = () => { let set = changed.get(name); if (!set) changed.set(name, set = new Set()); return set; };
  const on = (cb: (ctx: any) => void) => { callbacks().add(cb); };
  const off = (cb: (ctx: any) => void) => { callbacks().delete(cb); };
  return { iter: () => benchStore.get(name).values(), onInsert: on, onDelete: on, onUpdate: on, removeOnInsert: off, removeOnDelete: off, removeOnUpdate: off };
};
const tablesByAccessor = new Map<string, ReturnType<typeof tableFor>>();
const connection = {
  db: new Proxy({}, {
    get(_, accessor) {
      if (typeof accessor !== 'string') return undefined;
      let table = tablesByAccessor.get(accessor);
      if (!table) tablesByAccessor.set(accessor, table = tableFor(accessor));
      return table;
    },
  }),
  reducers: new Proxy({}, { get: () => () => {} }),
};
export function useSpacetimeDB() {
  return { identity: benchStore.identity, getConnection: () => connection, isActive: true };
}
export const SpacetimeDBProvider = ({ children }: any) => children;
