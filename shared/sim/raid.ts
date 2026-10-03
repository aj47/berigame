/**
 * Scheduled Giant raids. The Giant sleeps between raids and wakes at fixed,
 * predictable UTC times (every RAID_INTERVAL_MS on the epoch grid: 00:00,
 * 00:20, 00:40, 01:00 ... UTC). Awake, it has more HP the more players were in the
 * Boulders when it woke (bounded); left undefeated for RAID_WINDOW_MS it goes
 * back to sleep. Pure rules shared by the module and the client countdown.
 *
 * Tick cost while asleep: one primary-key read of the raid row and a couple of
 * number compares; the row is written only when an announcement goes out or
 * the Giant wakes.
 */
import { OBSIDIAN_ITEM_ID } from './items';

/** Wake cadence: every 20 minutes, at :00, :20 and :40 (UTC). */
export const RAID_INTERVAL_MS = 20 * 60 * 1000;
/** How long a raid lasts before the Giant goes back to sleep undefeated. */
export const RAID_WINDOW_MS = 15 * 60 * 1000;
/** World-wide announcements before a wake: T-10 min and T-1 min. Longest first. */
export const RAID_ANNOUNCE_LEADS_MS = [10 * 60 * 1000, 60 * 1000] as const;

/** Raid HP: base for up to one player, plus a share per extra player, bounded. */
export const RAID_HP_BASE = 600;
export const RAID_HP_PER_PLAYER = 200;
/** Players counted for HP (the rest are free help): 600..2000 HP. */
export const RAID_HP_MAX_PLAYERS = 8;
/** Damage this raid needed to share in the reward and the keepsake (three club blows). */
export const RAID_MIN_CONTRIBUTION = 24;
/** Every qualifying contributor gets the same reward (equal shares, no top-damage bonus). */
export const RAID_REWARD: { itemId: string; quantity: number } = { itemId: OBSIDIAN_ITEM_ID, quantity: 6 };

/** `giant_raid.lastOutcome` on the wire (u8). */
export const RaidOutcome = { None: 0, Defeated: 1, Slept: 2 } as const;
export type RaidOutcome = (typeof RaidOutcome)[keyof typeof RaidOutcome];

/** The first scheduled wake strictly after `nowMs`. */
export function nextRaidWakeMs(nowMs: number, intervalMs = RAID_INTERVAL_MS): number {
  return Math.floor(nowMs / intervalMs) * intervalMs + intervalMs;
}

/** HP for a raid that woke with `players` in the Boulders. */
export function raidMaxHp(players: number): number {
  const n = Math.max(1, Math.min(RAID_HP_MAX_PLAYERS, Math.floor(players) || 0));
  return RAID_HP_BASE + RAID_HP_PER_PLAYER * (n - 1);
}

export function raidRewardees<T extends { damage: number }>(contributions: readonly T[]): T[] {
  return contributions.filter((c) => c.damage >= RAID_MIN_CONTRIBUTION);
}

export interface RaidRowLike {
  awake: boolean;
  /** Asleep: the next wake. */
  nextWakeAtMicros: bigint;
  /** Awake: when it goes back to sleep undefeated. */
  raidEndsAtMicros: bigint;
  /** Announcement bits already sent for the upcoming wake (bit i = RAID_ANNOUNCE_LEADS_MS[i]). */
  announced: number;
}

export type RaidDue =
  | { kind: 'none' }
  | { kind: 'announce'; minutes: number; announced: number }
  | { kind: 'wake' }
  | { kind: 'missed' }
  | { kind: 'sleep' };

/**
 * What the schedule wants at `nowMs`. Asleep: an announcement whose lead time
 * has arrived (only the shortest when several are due at once), the wake, or
 * 'missed' when the whole raid window already passed (the module was down):
 * then it just reschedules. Awake: 'sleep' once the window ends.
 */
export function raidDue(row: RaidRowLike, nowMs: number): RaidDue {
  if (row.awake) return nowMs >= Number(row.raidEndsAtMicros) / 1000 ? { kind: 'sleep' } : { kind: 'none' };
  const wake = Number(row.nextWakeAtMicros) / 1000;
  if (nowMs >= wake + RAID_WINDOW_MS) return { kind: 'missed' };
  if (nowMs >= wake) return { kind: 'wake' };
  let due = -1;
  RAID_ANNOUNCE_LEADS_MS.forEach((lead, i) => { if (nowMs >= wake - lead) due = i; });
  if (due < 0 || (row.announced & (1 << due)) !== 0) return { kind: 'none' };
  // Every lead up to and including `due` counts as sent (never "10 min" after "1 min").
  const bits = (1 << (due + 1)) - 1;
  return { kind: 'announce', minutes: Math.round(RAID_ANNOUNCE_LEADS_MS[due] / 60000), announced: row.announced | bits };
}

/** "12:34" (or "1:02:03" past an hour) until `targetMs`, never negative. */
export function formatCountdown(targetMs: number, nowMs: number): string {
  const total = Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Client-side view of the raid row: what the HUD shows. */
export function raidStatus(row: RaidRowLike | null | undefined, nowMs: number): { awake: boolean; targetMs: number; label: string } | null {
  if (!row) return null;
  if (row.awake) {
    const end = Number(row.raidEndsAtMicros) / 1000;
    return { awake: true, targetMs: end, label: `Giant raid! ${formatCountdown(end, nowMs)} left` };
  }
  const wake = Number(row.nextWakeAtMicros) / 1000;
  return { awake: false, targetMs: wake, label: `The Giant wakes in ${formatCountdown(wake, nowMs)}` };
}
