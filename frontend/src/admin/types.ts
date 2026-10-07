import type { CoinDay, Cohort, DailyPoint } from '../../../shared/sim/adminStats';

/** Shapes returned by the Worker's /api/admin routes (spacetimedb/src/lib/adminSnapshot.ts + the gateway). */
export type Counters = Record<'sessions' | 'playSeconds' | 'harvests' | 'gathered' | 'crafts' | 'kills' | 'deaths' | 'trades' | 'deposits' | 'chats', number>;

export type PlayerRow = {
  id: string; name: string; agent: boolean; online: boolean; region: string; x: number; z: number;
  hp: number; maxHp: number; dead: boolean; weapon: string; load: number;
  firstJoin: number | null; lastSeen: number | null; sessions: number; playSeconds: number; lastStep: string;
  deaths: number; kills: number; activeDays: number; coins: number; regionXp: number; quests: number; groveXp: number;
  carried: number; vaultValue: number; energy: { band: string; points: number; max: number } | null; today: Counters | null;
};

export type Distribution = { holders: number; total: number; median: number; p90: number; max: number; top10Share: number; gini: number };
export type LedgerRow = { id: string; owner: string; amount: number; reason: string; at: number; name?: string };
export type ItemRow = { itemId: string; name: string; bags: number; vaults: number; storage: number; ground: number; total: number; unitValue: number; value: number };

export type GameSnapshot = {
  generatedAt: number; today: number; days: number;
  world: { tick: number; tickAt: number | null; characters: number; online: number; onlineAgents: number; onlineByRegion: Record<string, number>; deadNow: number; glowing: number; requireAdmission: boolean };
  active: { dau: number; wau: number; mau: number };
  activitySince: number | null;
  series: DailyPoint[];
  cohorts: Cohort[];
  funnel: { step: string; reached: number; stopped: number }[];
  economy: {
    coins: Distribution; wealth: Distribution; ledgerTotal: number; walletTotal: number; ledgerEntries: number;
    coinDays: CoinDay[]; reasons: { reason: string; minted: number; burned: number; entries: number }[];
    richest: { id: string; name: string; agent: boolean; coins: number; vaultValue: number }[];
    items: ItemRow[]; claims: { total: number; byStatus: Record<string, number>; byTier: Record<string, number> };
    energy: Record<string, number>; recentLedger: LedgerRow[];
  };
  disciplines: string[];
  playersTotal: number;
  players: PlayerRow[];
};

export type GatewayStats = {
  sessions: { kind: string; state: string; n: number; actions: number | null }[];
  daily: { day: string; joins: number; requests: number }[];
  invites: { kind: string; n: number }[];
  renewals: number;
  accounts: { total: number; withCharacter: number; seen1d: number; seen7d: number; new7d: number; byProvider: { provider: string; n: number }[] };
};

export type Snapshot = { game: GameSnapshot; gateway: GatewayStats };

export type PlayerDetail = {
  game: {
    generatedAt: number; id: string; name: string; online: boolean; connections: number; region: string; x: number; z: number;
    hp: number; maxHp: number; dead: boolean; weapon: string; load: number; lastSeen: number | null;
    grant: { agent: boolean; combat: boolean; chat: boolean; expiresAt: number } | null;
    stats: { firstJoin: number | null; sessions: number; playSeconds: number; deaths: number; lastStep: string; sessionStartedAt: number | null;
      milestones: Record<'berry' | 'stick' | 'hedge' | 'coast' | 'craft', number | null> } | null;
    skills: { foraging: number; beachcombing: number; crafting: number } | null;
    profile: { coins: number; xp: Record<string, number>; quests: string[]; events: Record<string, number>; discoveries: string[];
      companion: string; tame: Record<string, number>; repeatCoinsToday: number; notes: string[] } | null;
    energy: { points: number; max: number; restedLine: number; band: string } | null;
    bag: { slot: number; itemId: string; quantity: number }[]; bagValue: number;
    containers: { id: string; slots: { itemId: string; quantity: number }[]; value: number }[];
    claims: { id: string; tier: number; status: string; paidUntil: number }[];
    activity: (Counters & { day: number; agent: boolean; actions: Record<string, number> })[];
    ledger: LedgerRow[]; ledgerTotal: number;
    chat: { at: number | null; text: string }[];
  };
  gateway: { account: { createdAt: number; seenAt: number; logins: string[] } | null; sessions: { kind: string; state: string; actions_count: number; last_seen: number; expires_at: number }[] };
};
