import { create } from 'zustand';
import { Pending } from '@sim';
import type { BossConfig, BossEvent, BossNotice, Clatterhorn, SpireFight, SpireMember, SpireRun } from '../module_bindings/types';

/**
 * Boss data for the client (FINAL_SPEC 7.1): a zustand store fed by BossSync
 * from the connection's own subscriptions, so no boss data goes through
 * `spacetime/hooks.ts` and the hook-mocking tests stay untouched. With no
 * provider (tests) the store stays empty and every component renders as before.
 */
export type BossConfigRow = BossConfig;
export type ClatterhornRow = Clatterhorn;
export type SpireRunRow = SpireRun;
export type SpireMemberRow = SpireMember;
export type SpireFightRow = SpireFight;
export type BossEventRow = BossEvent;
export type BossNoticeRow = BossNotice;

export type BossTable = 'bossConfig' | 'clatterhorn' | 'spireRun' | 'spireMember' | 'spireFight';
type RowOf<T extends BossTable> = {
  bossConfig: BossConfigRow; clatterhorn: ClatterhornRow; spireRun: SpireRunRow; spireMember: SpireMemberRow; spireFight: SpireFightRow;
}[T];
/** A row's key: config/clatterhorn id, run id, member identity hex, fight run id (bigints and numbers as strings). */
export type BossRowKey = string | number | bigint;

export interface Seq<R> { seq: number; row: R }
export interface SwingCue { seq: number; hex: string; tick: number }

export const BOSS_NOTICE_RING = 64;
export const BOSS_EVENT_RING = 32;
export const SWING_CUE_RING = 64;

export interface BossState {
  config: BossConfigRow | null;
  clatter: ClatterhornRow | null;
  /** Every run (lobbies, active, lingering results), keyed by run id. */
  runs: Map<string, SpireRunRow>;
  /** Every party member, keyed by identity hex. */
  members: Map<string, SpireMemberRow>;
  /** Fight rows in the client cache (only your run's is subscribed), keyed by run id. */
  fights: Map<string, SpireFightRow>;
  /** Your run's fight row. */
  fight: SpireFightRow | null;
  meHex: string | null;
  myMember: SpireMemberRow | null;
  myRun: SpireRunRow | null;
  /** Identity hexes of every member of your run (you included); empty without a membership. */
  myRunHexes: ReadonlySet<string>;
  /** Your boss_notice rows (RLS), newest last. */
  notices: readonly Seq<BossNoticeRow>[];
  /** World boss moments, newest last. */
  events: readonly Seq<BossEventRow>[];
  /** Other players' Clatterhorn swings, derived from their player rows. */
  swingCues: readonly SwingCue[];
  /** UI: the Spire lobby panel is open (SpireGate sets it, SpireLobbyPanel reads it). */
  lobbyOpen: boolean;
  seq: number;

  setMe: (hex: string | null) => void;
  setRow: <T extends BossTable>(table: T, row: RowOf<T>) => void;
  deleteRow: (table: BossTable, key: BossRowKey) => void;
  pushNotice: (row: BossNoticeRow) => void;
  pushEvent: (row: BossEventRow) => void;
  pushSwingCue: (hex: string, tick: number) => void;
  /** A player row update: pushes a swing cue when it shows a landed Clatterhorn swing. */
  onPlayerUpdate: (prev: SwingRow, row: SwingRow & { identity: { toHexString(): string } }) => void;
  setLobbyOpen: (open: boolean) => void;
  reset: () => void;
}

/** The player-row fields the swing-cue rule reads. */
export interface SwingRow { pending: number; nextSwingTick: number; eatCooldownUntilTick: number }

/**
 * The tick of a landed Clatterhorn swing shown by a player-row update, or null.
 * A landed swing moves `nextSwingTick` from <= T to T + 4 while `pending`
 * stays Clatterhorn; `attack_clatterhorn` changes `pending` (or leaves the row
 * unchanged when re-selected); a meal moves `nextSwingTick` by >= 3 but
 * always rewrites `eatCooldownUntilTick`. Reads only the two rows, so the
 * order of the world and player updates in one transaction does not matter.
 */
export function swingCueTick(prev: SwingRow, row: SwingRow): number | null {
  if (prev.pending !== Pending.Clatterhorn || row.pending !== Pending.Clatterhorn) return null;
  if (row.nextSwingTick - prev.nextSwingTick < 4 || row.eatCooldownUntilTick !== prev.eatCooldownUntilTick) return null;
  return row.nextSwingTick - 4;
}

const keyOf = (k: BossRowKey) => String(k);
const EMPTY_HEXES: ReadonlySet<string> = new Set();

type Data = Pick<BossState, 'config' | 'clatter' | 'runs' | 'members' | 'fights' | 'meHex'>;

/** The fields derived from your membership. */
function derive(s: Data): Pick<BossState, 'myMember' | 'myRun' | 'myRunHexes' | 'fight'> {
  const myMember = (s.meHex && s.members.get(s.meHex)) || null;
  if (!myMember) return { myMember: null, myRun: null, myRunHexes: EMPTY_HEXES, fight: null };
  const runKey = keyOf(myMember.runId);
  const hexes = new Set<string>();
  for (const [hex, m] of s.members) if (m.runId === myMember.runId) hexes.add(hex);
  return { myMember, myRun: s.runs.get(runKey) ?? null, myRunHexes: hexes, fight: s.fights.get(runKey) ?? null };
}

function initial(): Omit<BossState, 'setMe' | 'setRow' | 'deleteRow' | 'pushNotice' | 'pushEvent' | 'pushSwingCue' | 'onPlayerUpdate' | 'setLobbyOpen' | 'reset'> {
  return {
    config: null, clatter: null, runs: new Map(), members: new Map(), fights: new Map(), fight: null,
    meHex: null, myMember: null, myRun: null, myRunHexes: EMPTY_HEXES,
    notices: [], events: [], swingCues: [], lobbyOpen: false, seq: 0,
  };
}

export const useBossStore = create<BossState>((set, get) => {
  /** Apply a data change and recompute the derived fields. */
  const update = (patch: Partial<Data>) => {
    const next = { ...get(), ...patch };
    set({ ...patch, ...derive(next) });
  };
  return {
    ...initial(),

    setMe: (hex) => { if (get().meHex !== hex) update({ meHex: hex }); },

    setRow: (table, row) => {
      const s = get();
      switch (table) {
        case 'bossConfig': update({ config: row as BossConfigRow }); break;
        case 'clatterhorn': update({ clatter: row as ClatterhornRow }); break;
        case 'spireRun': { const r = row as SpireRunRow; update({ runs: new Map(s.runs).set(keyOf(r.id), r) }); break; }
        case 'spireMember': { const m = row as SpireMemberRow & { identity: { toHexString(): string } }; update({ members: new Map(s.members).set(m.identity.toHexString(), m) }); break; }
        case 'spireFight': { const f = row as SpireFightRow; update({ fights: new Map(s.fights).set(keyOf(f.runId), f) }); break; }
      }
    },

    deleteRow: (table, key) => {
      const s = get(), k = keyOf(key);
      const without = <V,>(m: Map<string, V>) => { const n = new Map(m); n.delete(k); return n; };
      switch (table) {
        case 'bossConfig': if (s.config && keyOf(s.config.id) === k) update({ config: null }); break;
        case 'clatterhorn': if (s.clatter && keyOf(s.clatter.id) === k) update({ clatter: null }); break;
        case 'spireRun': if (s.runs.has(k)) update({ runs: without(s.runs) }); break;
        case 'spireMember': if (s.members.has(k)) update({ members: without(s.members) }); break;
        case 'spireFight': if (s.fights.has(k)) update({ fights: without(s.fights) }); break;
      }
    },

    pushNotice: (row) => {
      // boss_notice has no server-side filter: keep only notices addressed to this player.
      const me = get().meHex;
      if (!me || row.player?.toHexString?.() !== me) return;
      const seq = get().seq + 1;
      set({ seq, notices: [...get().notices, { seq, row }].slice(-BOSS_NOTICE_RING) });
    },
    pushEvent: (row) => {
      const seq = get().seq + 1;
      set({ seq, events: [...get().events, { seq, row }].slice(-BOSS_EVENT_RING) });
    },
    pushSwingCue: (hex, tick) => {
      const seq = get().seq + 1;
      set({ seq, swingCues: [...get().swingCues, { seq, hex, tick }].slice(-SWING_CUE_RING) });
    },
    onPlayerUpdate: (prev, row) => {
      const tick = swingCueTick(prev, row);
      if (tick !== null) get().pushSwingCue(row.identity.toHexString(), tick);
    },

    setLobbyOpen: (open) => { if (get().lobbyOpen !== open) set({ lobbyOpen: open }); },

    reset: () => set(initial()),
  };
});
