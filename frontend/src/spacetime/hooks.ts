import { useMemo } from 'react';
import { useSpacetimeDB, useTable } from 'spacetimedb/react';
import { tables, type DbConnection } from '../module_bindings';
import type { Player } from '../module_bindings/types';
import { identityHex } from './identity';

export function useMyIdentityHex(): string | null {
  const { identity } = useSpacetimeDB<DbConnection>();
  return identity ? identityHex(identity) : null;
}

export function useWorld() {
  const [rows] = useTable(tables.world);
  return rows[0] ?? null;
}

export function useTick(): number {
  return useWorld()?.tick ?? 0;
}

export function usePlayers(): readonly Player[] {
  const [rows] = useTable(tables.player);
  return rows;
}

export function usePlayersByHex(): Map<string, Player> {
  const rows = usePlayers();
  return useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of rows) m.set(identityHex(p.identity), p);
    return m;
  }, [rows]);
}

export function useMyPlayer(): Player | null {
  const { identity } = useSpacetimeDB<DbConnection>();
  const id = identity?.__identity__;
  const players = usePlayers();
  // Identity.isEqual also formats both operands in SDK 2.10; compare its
  // public u256 value directly instead of allocating strings for every row.
  return useMemo(() => (id !== undefined ? players.find((p) => p.identity.__identity__ === id) ?? null : null), [id, players]);
}

export function useTrees() {
  const [rows] = useTable(tables.tree);
  return rows;
}

export function useGroundItems() {
  const [rows] = useTable(tables.groundItem);
  return rows;
}

export function useChatMessages() {
  const [rows] = useTable(tables.chatMessage);
  return useMemo(
    () => [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    [rows]
  );
}

/** Only this client's rows arrive (row-level security on the server). */
export function useInventoryRows() {
  const [rows] = useTable(tables.inventorySlot);
  return rows;
}

export function useAppearanceRows() {
  const [rows] = useTable(tables.appearance);
  return rows;
}
