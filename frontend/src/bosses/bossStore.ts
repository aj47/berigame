import { create } from 'zustand';
import { Pending } from '@sim';
import type {
  BossConfig, BossEvent, BossNotice, Clatterhorn, LanternConfig, LanternFight, LanternMember, LanternRun, SpireFight, SpireMember, SpireRun,
} from '../module_bindings/types';

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
export type LanternConfigRow = LanternConfig;
export type LanternRunRow = LanternRun;
export type LanternMemberRow = LanternMember;
export type LanternFightRow = LanternFight;

export type BossTable = 'bossConfig' | 'clatterhorn' | 'spireRun' | 'spireMember' | 'spireFight'
  | 'lanternConfig' | 'lanternRun' | 'lanternMember' | 'lanternFight';
type RowOf<T extends BossTable> = {
  bossConfig: BossConfigRow; clatterhorn: ClatterhornRow; spireRun: SpireRunRow; spireMember: SpireMemberRow; spireFight: SpireFightRow;
  lanternConfig: LanternConfigRow; lanternRun: LanternRunRow; lanternMember: LanternMemberRow; lanternFight: LanternFightRow;
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

  // Lanternmaw (BOSSES.md 9): the same shape as the Spire's, in its own lantern_* tables.
  /** The lantern_config row (absent = closed: lanternConfigOr). */
  lanternConfig: LanternConfigRow | null;
  lanternRuns: Map<string, LanternRunRow>;
  lanternMembers: Map<string, LanternMemberRow>;
  /** Fight rows in the cache (only your run's is subscribed), keyed by run id. */
  lanternFights: Map<string, LanternFightRow>;
  lanternFight: LanternFightRow | null;
  myLanternMember: LanternMemberRow | null;
  myLanternRun: LanternRunRow | null;
  /** Identity hexes of every member of your lantern run (you included). */
  myLanternHexes: ReadonlySet<string>;
  /** UI: the Fen Gate's lobby panel is open. */
  lanternLobbyOpen: boolean;
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
  setLanternLobbyOpen: (open: boolean) => void;
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

type Data = Pick<BossState, 'config' | 'clatter' | 'runs' | 'members' | 'fights' | 'meHex'
  | 'lanternConfig' | 'lanternRuns' | 'lanternMembers' | 'lanternFights'>;

/** Your membership in one run table: the member row, its run, every member's hex and the run's fight row. */
function membership<M extends { runId: bigint }, R, F>(meHex: string | null, members: Map<string, M>, runs: Map<string, R>, fights: Map<string, F>) {
  const member = (meHex && members.get(meHex)) || null;
  if (!member) return { member: null, run: null, hexes: EMPTY_HEXES, fight: null };
  const runKey = keyOf(member.runId);
  const hexes = new Set<string>();
  for (const [hex, m] of members) if (m.runId === member.runId) hexes.add(hex);
  return { member, run: runs.get(runKey) ?? null, hexes: hexes as ReadonlySet<string>, fight: fights.get(runKey) ?? null };
}

/** The fields derived from your memberships. */
function derive(s: Data): Pick<BossState, 'myMember' | 'myRun' | 'myRunHexes' | 'fight' | 'myLanternMember' | 'myLanternRun' | 'myLanternHexes' | 'lanternFight'> {
  const sp = membership(s.meHex, s.members, s.runs, s.fights);
  const ln = membership(s.meHex, s.lanternMembers, s.lanternRuns, s.lanternFights);
  return {
    myMember: sp.member, myRun: sp.run, myRunHexes: sp.hexes, fight: sp.fight,
    myLanternMember: ln.member, myLanternRun: ln.run, myLanternHexes: ln.hexes, lanternFight: ln.fight,
  };
}

function initial(): Omit<BossState, 'setMe' | 'setRow' | 'deleteRow' | 'pushNotice' | 'pushEvent' | 'pushSwingCue' | 'onPlayerUpdate' | 'setLobbyOpen' | 'setLanternLobbyOpen' | 'reset'> {
  return {
    config: null, clatter: null, runs: new Map(), members: new Map(), fights: new Map(), fight: null,
    meHex: null, myMember: null, myRun: null, myRunHexes: EMPTY_HEXES,
    notices: [], events: [], swingCues: [], lobbyOpen: false, seq: 0,
    lanternConfig: null, lanternRuns: new Map(), lanternMembers: new Map(), lanternFights: new Map(), lanternFight: null,
    myLanternMember: null, myLanternRun: null, myLanternHexes: EMPTY_HEXES, lanternLobbyOpen: false,
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
        case 'lanternConfig': update({ lanternConfig: row as LanternConfigRow }); break;
        case 'lanternRun': { const r = row as LanternRunRow; update({ lanternRuns: new Map(s.lanternRuns).set(keyOf(r.id), r) }); break; }
        case 'lanternMember': { const m = row as LanternMemberRow & { identity: { toHexString(): string } }; update({ lanternMembers: new Map(s.lanternMembers).set(m.identity.toHexString(), m) }); break; }
        case 'lanternFight': { const f = row as LanternFightRow; update({ lanternFights: new Map(s.lanternFights).set(keyOf(f.runId), f) }); break; }
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
        case 'lanternConfig': if (s.lanternConfig && keyOf(s.lanternConfig.id) === k) update({ lanternConfig: null }); break;
        case 'lanternRun': if (s.lanternRuns.has(k)) update({ lanternRuns: without(s.lanternRuns) }); break;
        case 'lanternMember': if (s.lanternMembers.has(k)) update({ lanternMembers: without(s.lanternMembers) }); break;
        case 'lanternFight': if (s.lanternFights.has(k)) update({ lanternFights: without(s.lanternFights) }); break;
      }
    },

    pushNotice: (row) => {
      // boss_notice has no RLS (the subscription query filters it): still keep only notices addressed to this player.
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
    setLanternLobbyOpen: (open) => { if (get().lanternLobbyOpen !== open) set({ lanternLobbyOpen: open }); },

    reset: () => set(initial()),
  };
});
