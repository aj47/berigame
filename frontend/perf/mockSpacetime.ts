/** Bench-only stand-in for 'spacetimedb/react': tables served from an in-memory store. */
import { useSyncExternalStore } from 'react';
import type { Identity } from 'spacetimedb';

const EMPTY: readonly any[] = [];
const rows: Record<string, readonly any[]> = {};
const listeners = new Set<() => void>();
export const benchStore = {
  identity: undefined as Identity | undefined,
  set(table: string, value: readonly any[]) { rows[table] = value; for (const l of listeners) l(); },
  get(table: string) { return rows[table] ?? EMPTY; },
};
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useTable(table: any): [readonly any[], boolean] {
  const name: string = table?.name ?? table?.tableName ?? table?.sourceName;
  return [useSyncExternalStore(subscribe, () => benchStore.get(name)), true];
}
export function useSpacetimeDB() {
  return { identity: benchStore.identity, getConnection: () => null, isActive: true };
}
export const SpacetimeDBProvider = ({ children }: any) => children;
