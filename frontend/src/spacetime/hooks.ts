import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
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
    if (id !== undefined && id === lastEvent) return;
    lastEvent = id;
    // The SDK applies every row before dispatching the transaction's callbacks.
    // A later callback for this same transaction must not invalidate that full snapshot again.
    store.dirty = true;
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

/** Subscribe only to the tick-derived value a component displays (for example, a protection deadline). */
export function useTickSelector<T>(select: (tick: number) => T): T {
  const fromWorld = useCallback((rows: readonly any[]) => select(rows[0]?.tick ?? 0), [select]);
  return useTableSelector(tables.world, fromWorld);
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

/** Select a stable value from your row without rerendering for unrelated HP, movement, or action changes. */
export function useMyPlayerSelector<T>(selectPlayer: (player: Player | null) => T): T {
  const { identity } = useSpacetimeDB<DbConnection>();
  const id = identity?.__identity__;
  // Identity.isEqual also formats both operands in SDK 2.10; compare its
  // public u256 value directly instead of allocating strings for every row.
  const select = useCallback((rows: readonly any[]): T => {
    if (id !== undefined) for (const p of rows) if (p.identity.__identity__ === id) return selectPlayer(p);
    return selectPlayer(null);
  }, [id, selectPlayer]);
  return useTableSelector(tables.player, select);
}

const selectPlayerRow = (player: Player | null) => player;
export function useMyPlayer(): Player | null {
  return useMyPlayerSelector(selectPlayerRow);
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

/** The Boulders' Giant (one row; absent until the first tick seeds it). */
export function useGiants() {
  return useRows<any>(tables.giant) as readonly import('../module_bindings/types').Giant[];
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

// ---- F2 skills and milestone cosmetics -----------------------------------------

type SkillRow = import('../module_bindings/types').PlayerSkill;
type CosmeticRow = import('../module_bindings/types').PlayerCosmetic;

/** Your player_skill row (null until your first XP). Re-renders only when it changes. */
export function useMySkills(): SkillRow | null {
  const { identity } = useSpacetimeDB<DbConnection>();
  const id = identity?.__identity__;
  const select = useCallback((rows: readonly any[]): SkillRow | null => {
    if (id === undefined) return null;
    for (const r of rows) if (r.identity.__identity__ === id) return r;
    return null;
  }, [id]);
  return useTableSelector(tables.playerSkill, select);
}

/** Your player_cosmetic row (null until your first unlock). */
export function useMyCosmetics(): CosmeticRow | null {
  const { identity } = useSpacetimeDB<DbConnection>();
  const id = identity?.__identity__;
  const select = useCallback((rows: readonly any[]): CosmeticRow | null => {
    if (id === undefined) return null;
    for (const r of rows) if (r.identity.__identity__ === id) return r;
    return null;
  }, [id]);
  return useTableSelector(tables.playerCosmetic, select);
}

const wornCache = new WeakMap<readonly any[], Map<string, number>>();
const buildWorn = (rows: readonly any[]) => {
  const m = new Map<string, number>();
  for (const r of rows) if (r.head || r.neck) m.set(identityHex(r.identity), r.head * 256 + r.neck);
  return m;
};

/**
 * What one avatar wears, packed as head * 256 + neck (0 = nothing). A number,
 * so the avatar re-renders only when its own cosmetics change.
 */
export function useWornCosmetics(hex: string): number {
  const select = useCallback((rows: readonly any[]) => derived(wornCache, rows, buildWorn).get(hex) ?? 0, [hex]);
  return useTableSelector(tables.playerCosmetic, select);
}

// ---- Scheduled Giant raids and mentors ---------------------------------------

/** The Giant's raid schedule (one row; absent until the first tick seeds it). */
export function useGiantRaid() {
  const rows = useRows<any>(tables.giantRaid) as readonly import('../module_bindings/types').GiantRaid[];
  return rows[0] ?? null;
}

const menteeCache = new WeakMap<readonly any[], Map<string, number>>();
const buildMentees = (rows: readonly any[]) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(identityHex(r.identity), r.mentees);
  return m;
};

/** Mentee counts by identity hex (public mentor_stat rows). */
export function useMenteeCounts(): Map<string, number> {
  const rows = useRows<any>(tables.mentorStat);
  return derived(menteeCache, rows, buildMentees);
}

/** Date.now(), refreshed every `ms` while mounted (countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---- Personal garden ----------------------------------------------------------

/** Your garden plots (row-level security: only your own rows arrive). An empty plot has no row. */
export function useGardenPlots() {
  return useRows<any>(tables.gardenPlot) as readonly import('../module_bindings/types').GardenPlot[];
}

export function useAdventureProfiles() { return useRows<any>(tables.adventureProfile) as readonly import('../module_bindings/types').AdventureProfile[]; }
export function useExpeditions() { return useRows<any>(tables.expedition) as readonly import('../module_bindings/types').Expedition[]; }
export function useExpeditionMembers() { return useRows<any>(tables.expeditionMember) as readonly import('../module_bindings/types').ExpeditionMember[]; }
export function useIslandProjects() { return useRows<any>(tables.islandProject) as readonly import('../module_bindings/types').IslandProject[]; }
export function useGardenShowcases() { return useRows<any>(tables.gardenShowcase) as readonly import('../module_bindings/types').GardenShowcase[]; }
export function useFriendlyDuels() { return useRows<any>(tables.friendlyDuel) as readonly import('../module_bindings/types').FriendlyDuel[]; }

export function useFrontierObjects() { return useRows<import('../module_bindings/types').FrontierObject>(tables.frontierObject); }
export function useFrontierObjectsSelector<T>(select: (rows: readonly import('../module_bindings/types').FrontierObject[]) => T): T {
  return useTableSelector(tables.frontierObject, select);
}
export function useFrontierViews() { return useRows<import('../module_bindings/types').FrontierView>(tables.frontierView); }

/** Your energy meter (shared/sim/energy.ts), published to you alone through frontier_view. Undefined before your first harvest. */
export function useMyEnergy(): import('@sim').EnergyState | undefined {
  const me = useMyIdentityHex();
  // Select the JSON string (stable between snapshots), then parse once per change.
  const data = useTableSelector(tables.frontierView, (rows: readonly import('../module_bindings/types').FrontierView[]) => {
    const row = me ? rows.find((r) => r.kind === 'energy' && r.source === `energy:${me}`) : undefined;
    return row ? row.data : undefined;
  });
  return useMemo(() => {
    if (!data) return undefined;
    try { return JSON.parse(data) as import('@sim').EnergyState; } catch { return undefined; }
  }, [data]);
}

/** Your personal vault's slots (the town bank and the Grove vault are one store). Empty before the first deposit. */
export function useMyVaultSlots(): readonly import('@sim').Slot[] {
  const me = useMyIdentityHex();
  const data = useTableSelector(tables.frontierView, (rows: readonly import('../module_bindings/types').FrontierView[]) => {
    const row = me ? rows.find((r) => r.kind === 'container' && r.source === `container:vault-${me}`) : undefined;
    return row ? row.data : undefined;
  });
  return useMemo(() => {
    if (!data) return EMPTY;
    try { return (JSON.parse(data).slots ?? EMPTY) as readonly import('@sim').Slot[]; } catch { return EMPTY; }
  }, [data]);
}
