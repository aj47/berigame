/**
 * Pure aggregation for the owner's admin panel (docs/ANALYTICS.md). The module
 * reads private rows into these plain shapes; everything here is arithmetic,
 * so it is unit-tested without a database.
 */

export const DAY_MS = 86_400_000;
export const utcDayOf = (ms: number): number => Math.floor(ms / DAY_MS);

/** Counter columns of `daily_activity`, in table order. */
export const ACTIVITY_COUNTERS = [
  'sessions', 'playSeconds', 'harvests', 'gathered', 'crafts', 'kills', 'deaths', 'trades', 'deposits', 'chats',
] as const;
export type ActivityCounter = (typeof ACTIVITY_COUNTERS)[number];

export type ActivityDay = { day: number; identity: string; agent: boolean; actions: Record<string, number> }
  & Record<ActivityCounter, number>;

export type LedgerEntry = { owner: string; amount: number; reason: string; at: number };

/** `quest:meadow-1` and `order:7` group as `quest` and `order`. */
export const reasonGroup = (reason: string): string => reason.split(':')[0].trim() || 'unknown';

/** Coins that move between players: they change who holds coins, not how many exist. */
export const TRANSFER_REASONS = new Set(['player trade']);

export type DailyPoint = {
  day: number;
  dau: number;
  humans: number;
  agents: number;
  newPlayers: number;
  playHours: number;
  totals: Record<ActivityCounter, number>;
  actions: Record<string, number>;
};

const zeroTotals = () => Object.fromEntries(ACTIVITY_COUNTERS.map((k) => [k, 0])) as Record<ActivityCounter, number>;

/** One point per UTC day in [fromDay, toDay], including days nobody played. */
export function dailySeries(activity: readonly ActivityDay[], firstJoinDays: readonly number[], fromDay: number, toDay: number): DailyPoint[] {
  const points = new Map<number, DailyPoint>();
  for (let day = fromDay; day <= toDay; day++) {
    points.set(day, { day, dau: 0, humans: 0, agents: 0, newPlayers: 0, playHours: 0, totals: zeroTotals(), actions: {} });
  }
  for (const row of activity) {
    const point = points.get(row.day);
    if (!point) continue;
    point.dau++;
    if (row.agent) point.agents++; else point.humans++;
    for (const key of ACTIVITY_COUNTERS) point.totals[key] += row[key];
    for (const [action, n] of Object.entries(row.actions)) point.actions[action] = (point.actions[action] ?? 0) + n;
  }
  for (const day of firstJoinDays) {
    const point = points.get(day);
    if (point) point.newPlayers++;
  }
  for (const point of points.values()) point.playHours = Math.round((point.totals.playSeconds / 3600) * 10) / 10;
  return [...points.values()];
}

/** Distinct identities active in the trailing 1, 7 and 30 days ending on `today`. */
export function activeUsers(activity: readonly ActivityDay[], today: number) {
  const within = (days: number) => new Set(activity.filter((r) => r.day <= today && r.day > today - days).map((r) => r.identity)).size;
  return { dau: within(1), wau: within(7), mau: within(30) };
}

export type Cohort = { day: number; size: number; returned: Record<'d1' | 'd3' | 'd7', number | null> };

/**
 * Join-day cohorts and how many came back exactly N days later. A cell is null
 * while day N has not happened yet, so a young cohort is not read as churn.
 */
export function retentionCohorts(firstJoins: ReadonlyMap<string, number>, activity: readonly ActivityDay[], fromDay: number, today: number): Cohort[] {
  const activeDays = new Map<string, Set<number>>();
  for (const row of activity) {
    let days = activeDays.get(row.identity);
    if (!days) activeDays.set(row.identity, (days = new Set()));
    days.add(row.day);
  }
  const cohorts = new Map<number, string[]>();
  for (const [identity, day] of firstJoins) {
    if (day < fromDay || day > today) continue;
    const list = cohorts.get(day) ?? [];
    list.push(identity);
    cohorts.set(day, list);
  }
  const back = (members: string[], day: number, n: number) =>
    day + n > today ? null : members.filter((id) => activeDays.get(id)?.has(day + n)).length;
  return [...cohorts.entries()].sort((a, b) => a[0] - b[0]).map(([day, members]) => ({
    day, size: members.length, returned: { d1: back(members, day, 1), d3: back(members, day, 3), d7: back(members, day, 7) },
  }));
}

export type CoinDay = { day: number; minted: number; burned: number; transferred: number; supply: number; byReason: Record<string, number> };

/**
 * Coin sources and sinks per day from the ledger, plus the total supply at the
 * end of each day. The supply counts every ledger entry ever written, so days
 * before `fromDay` still set the starting balance.
 */
export function coinFlows(ledger: readonly LedgerEntry[], fromDay: number, toDay: number): CoinDay[] {
  const days = new Map<number, CoinDay>();
  for (let day = fromDay; day <= toDay; day++) days.set(day, { day, minted: 0, burned: 0, transferred: 0, supply: 0, byReason: {} });
  let opening = 0;
  for (const entry of ledger) {
    const day = utcDayOf(entry.at);
    if (day < fromDay) { opening += entry.amount; continue; }
    const point = days.get(day);
    if (!point) continue;
    const group = reasonGroup(entry.reason);
    point.byReason[group] = (point.byReason[group] ?? 0) + entry.amount;
    if (TRANSFER_REASONS.has(entry.reason)) point.transferred += Math.max(0, entry.amount);
    else if (entry.amount > 0) point.minted += entry.amount;
    else point.burned -= entry.amount;
  }
  let supply = opening;
  for (const point of days.values()) {
    supply += point.minted - point.burned;
    point.supply = supply;
  }
  return [...days.values()];
}

/** Lifetime coin totals by reason group: what creates coins and what removes them. */
export function coinReasons(ledger: readonly LedgerEntry[]) {
  const totals = new Map<string, { reason: string; minted: number; burned: number; entries: number }>();
  for (const entry of ledger) {
    const reason = reasonGroup(entry.reason);
    const row = totals.get(reason) ?? { reason, minted: 0, burned: 0, entries: 0 };
    if (entry.amount > 0) row.minted += entry.amount; else row.burned -= entry.amount;
    row.entries++;
    totals.set(reason, row);
  }
  return [...totals.values()].sort((a, b) => b.minted + b.burned - (a.minted + a.burned));
}

/** Total, spread and concentration of a holding (coins, item value) across players. */
export function distribution(values: readonly number[]) {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  const at = (q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);
  const top = Math.max(1, Math.ceil(sorted.length * 0.1));
  const topShare = total ? sorted.slice(-top).reduce((sum, v) => sum + v, 0) / total : 0;
  // Gini over holders only: 0 everyone holds the same, 1 one player holds everything.
  let weighted = 0;
  sorted.forEach((v, i) => { weighted += (2 * (i + 1) - sorted.length - 1) * v; });
  const gini = sorted.length && total ? weighted / (sorted.length * total) : 0;
  return { holders: sorted.length, total, median: at(0.5), p90: at(0.9), max: sorted.length ? sorted[sorted.length - 1] : 0, top10Share: topShare, gini };
}

export const FUNNEL_STEPS = ['join', 'berry', 'stick', 'hedge', 'coast', 'craft'] as const;

/** Players who reached each funnel step (a later step implies the earlier ones) and who stopped there. */
export function funnel(lastSteps: readonly string[]) {
  const index = (step: string) => Math.max(0, FUNNEL_STEPS.indexOf(step as (typeof FUNNEL_STEPS)[number]));
  return FUNNEL_STEPS.map((step, i) => ({
    step,
    reached: lastSteps.filter((s) => index(s) >= i).length,
    stopped: lastSteps.filter((s) => index(s) === i).length,
  }));
}
