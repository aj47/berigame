import type { Identity } from 'spacetimedb';
import { SenderError } from 'spacetimedb/server';
import { PlayerState, carriedValue, energyView, getItemDef, itemValue, type EnergyState, type Slot } from '../../../shared/sim';
import {
  ACTIVITY_COUNTERS, activeUsers, coinFlows, coinReasons, dailySeries, distribution, funnel, retentionCohorts, utcDayOf,
  type ActivityDay, type LedgerEntry,
} from '../../../shared/sim/adminStats';
import { claimStatus, type Claim, type Container, type GroundBag, type Profile } from '../../../shared/sim/frontier/model';
import { DISCIPLINES } from '../../../shared/sim/frontier/catalog';
import { hex } from './players';
import type { Ctx } from './types';

/**
 * Read-only snapshots for the owner's admin panel (docs/ANALYTICS.md), served
 * by the `admin_snapshot` and `admin_player` procedures. Only the world owner
 * and the configured gateway may call them; the gateway relays them to the
 * Worker's ADMIN_TOKEN-protected /api/admin routes.
 */
export function requireAdminReader(ctx: Ctx): void {
  const policy = ctx.db.accessPolicy.id.find(0);
  const sender = hex(ctx.sender);
  if (!policy || (hex(policy.owner) !== sender && (!policy.gateway || hex(policy.gateway) !== sender))) {
    throw new SenderError('world owner or gateway required');
  }
}

const MAX_DAYS = 120;
const MAX_PLAYERS = 2000;
const ms = (t: { microsSinceUnixEpoch: bigint } | undefined) => (t ? Number(t.microsSinceUnixEpoch / 1000n) : null);
const nowMs = (ctx: Ctx) => Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);

function privateRecords<T>(ctx: Ctx, kind: string): T[] {
  return Array.from(ctx.db.frontierPrivate.kind.filter(kind), (row) => JSON.parse(row.data) as T);
}
function publicRecords<T>(ctx: Ctx, kind: string): T[] {
  return Array.from(ctx.db.frontierObject.kind.filter(kind), (row) => JSON.parse(row.data) as T);
}

function activityRow(row: NonNullable<ReturnType<Ctx['db']['dailyActivity']['key']['find']>>): ActivityDay {
  let actions: Record<string, number> = {};
  try { actions = JSON.parse(row.actions || '{}'); } catch { /* a damaged map counts as none */ }
  return {
    day: row.day, identity: hex(row.identity), agent: row.agent, actions,
    sessions: row.sessions, playSeconds: row.playSeconds, harvests: row.harvests, gathered: row.gathered, crafts: row.crafts,
    kills: row.kills, deaths: row.deaths, trades: row.trades, deposits: row.deposits, chats: row.chats,
  };
}

function activityBetween(ctx: Ctx, fromDay: number, toDay: number): ActivityDay[] {
  const out: ActivityDay[] = [];
  if (!ctx.db.dailyActivity) return out;
  for (let day = fromDay; day <= toDay; day++) for (const row of ctx.db.dailyActivity.day.filter(day)) out.push(activityRow(row));
  return out;
}

function bags(ctx: Ctx): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>();
  for (const row of ctx.db.inventorySlot.iter()) {
    const owner = hex(row.owner);
    const list = out.get(owner) ?? [];
    list.push({ itemId: row.itemId, quantity: row.quantity });
    out.set(owner, list);
  }
  return out;
}

const slotValue = (slots: readonly (Slot | null)[]) => slots.reduce((sum, s) => sum + (s ? itemValue(s.itemId) * s.quantity : 0), 0);
const xpTotal = (p: Profile | undefined) => (p?.xp ?? []).reduce((a, b) => a + b, 0);

export function adminSnapshot(ctx: Ctx, requestedDays: number) {
  const now = nowMs(ctx);
  const today = utcDayOf(now);
  const days = Math.max(1, Math.min(MAX_DAYS, Math.floor(requestedDays) || 30));
  const fromDay = today - days + 1;
  // Retention and MAU need at least 30 days of activity behind the window's first day.
  const activity = activityBetween(ctx, Math.min(fromDay, today - 29), today);

  const stats = new Map(Array.from(ctx.db.playStats.iter(), (row) => [hex(row.identity), row]));
  const grants = new Map(Array.from(ctx.db.playerGrant.iter(), (row) => [hex(row.identity), row]));
  const profiles = new Map(privateRecords<Profile>(ctx, 'profile').map((p) => [p.id, p]));
  const energy = new Map(privateRecords<EnergyState>(ctx, 'energy').map((e) => [e.id, e]));
  const containers = privateRecords<Container>(ctx, 'container');
  const vaults = new Map(containers.filter((c) => c.id.startsWith('vault-')).map((c) => [c.owner, c]));
  const ledger = privateRecords<LedgerEntry & { id: string }>(ctx, 'ledger');
  const bagOf = bags(ctx);
  const skills = new Map(Array.from(ctx.db.playerSkill.iter(), (row) => [hex(row.identity), row]));

  // Lifetime kills and active days from the activity we hold.
  const lifetime = new Map<string, { kills: number; activeDays: number; today?: ActivityDay }>();
  for (const row of activity) {
    const entry = lifetime.get(row.identity) ?? { kills: 0, activeDays: 0 };
    entry.kills += row.kills;
    entry.activeDays++;
    if (row.day === today) entry.today = row;
    lifetime.set(row.identity, entry);
  }

  const players = Array.from(ctx.db.player.iter(), (p) => {
    const id = hex(p.identity);
    const s = stats.get(id);
    const profile = profiles.get(id);
    const skill = skills.get(id);
    const meter = energy.get(id);
    const view = meter ? energyView(meter, now) : null;
    const life = lifetime.get(id);
    const openSession = s?.sessionStartedAt && p.online ? Math.max(0, now - (ms(s.sessionStartedAt) ?? now)) : 0;
    return {
      id, name: p.name, agent: !!grants.get(id)?.agent, online: p.online, region: p.region || 'bramblewild', x: p.x, z: p.z,
      hp: p.hp, maxHp: p.maxHp, dead: p.state === PlayerState.Dead, weapon: p.weapon, load: p.load ?? 0,
      firstJoin: ms(s?.firstJoinAt), lastSeen: ms(p.lastSeenAt), sessions: s?.sessions ?? 0,
      playSeconds: Math.round((Number(s?.totalPlayMicros ?? 0n) / 1e6) + openSession / 1000),
      lastStep: s?.lastStep ?? 'join', deaths: s?.deaths ?? 0, kills: life?.kills ?? 0, activeDays: life?.activeDays ?? 0,
      coins: profile?.coins ?? 0, regionXp: xpTotal(profile), quests: profile?.quests.length ?? 0,
      groveXp: (skill?.foragingXp ?? 0) + (skill?.beachcombingXp ?? 0) + (skill?.craftingXp ?? 0),
      carried: carriedValue(bagOf.get(id) ?? []), vaultValue: slotValue(vaults.get(id)?.slots ?? []),
      energy: view ? { band: view.band, points: view.points, max: view.max } : null,
      today: life?.today ? Object.fromEntries(ACTIVITY_COUNTERS.map((k) => [k, life.today![k]])) : null,
    };
  });
  players.sort((a, b) => Number(b.online) - Number(a.online) || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  // Every item in the world, by where it is held.
  const items = new Map<string, { itemId: string; bags: number; vaults: number; storage: number; ground: number }>();
  const add = (itemId: string, where: 'bags' | 'vaults' | 'storage' | 'ground', n: number) => {
    const row = items.get(itemId) ?? { itemId, bags: 0, vaults: 0, storage: 0, ground: 0 };
    row[where] += n;
    items.set(itemId, row);
  };
  for (const slots of bagOf.values()) for (const slot of slots) if (slot) add(slot.itemId, 'bags', slot.quantity);
  for (const c of containers) for (const slot of c.slots) if (slot) add(slot.itemId, c.id.startsWith('vault-') ? 'vaults' : 'storage', slot.quantity);
  for (const g of ctx.db.groundItem.iter()) add(g.itemId, 'ground', g.quantity);
  for (const bag of publicRecords<GroundBag>(ctx, 'drop')) for (const slot of bag.slots) if (slot) add(slot.itemId, 'ground', slot.quantity);
  const itemRows = [...items.values()].map((row) => {
    const total = row.bags + row.vaults + row.storage + row.ground;
    return { ...row, name: getItemDef(row.itemId)?.name ?? row.itemId, total, unitValue: itemValue(row.itemId), value: total * itemValue(row.itemId) };
  }).sort((a, b) => b.total - a.total);

  const claims = publicRecords<Claim>(ctx, 'claim');
  const byStatus: Record<string, number> = {};
  for (const c of claims) { const status = claimStatus(c, now); byStatus[status] = (byStatus[status] ?? 0) + 1; }
  const bands: Record<string, number> = { rested: 0, normal: 0, tired: 0 };
  for (const p of players) if (p.energy) bands[p.energy.band]++;

  const online = players.filter((p) => p.online);
  const onlineByRegion: Record<string, number> = {};
  for (const p of online) onlineByRegion[p.region] = (onlineByRegion[p.region] ?? 0) + 1;
  const names = new Map(players.map((p) => [p.id, p.name]));
  const firstJoins = new Map<string, number>();
  for (const [id, s] of stats) firstJoins.set(id, utcDayOf(ms(s.firstJoinAt)!));
  const world = ctx.db.world.id.find(0);
  const ledgerTotal = ledger.reduce((sum, e) => sum + e.amount, 0);
  const walletTotal = players.reduce((sum, p) => sum + p.coins, 0);

  return {
    generatedAt: now, today, days,
    world: {
      tick: world?.tick ?? 0, tickAt: ms(world?.tickStartedAt), characters: players.length, online: online.length,
      onlineAgents: online.filter((p) => p.agent).length, onlineByRegion,
      deadNow: online.filter((p) => p.dead).length, glowing: online.filter((p) => p.load > 0).length,
      requireAdmission: !!ctx.db.accessPolicy.id.find(0)?.requireAdmission,
    },
    active: activeUsers(activity, today),
    activitySince: activity.length ? Math.min(...activity.map((r) => r.day)) : null,
    series: dailySeries(activity, [...firstJoins.values()], fromDay, today),
    cohorts: retentionCohorts(firstJoins, activity, fromDay, today),
    funnel: funnel([...stats.values()].map((s) => s.lastStep)),
    economy: {
      coins: distribution(players.map((p) => p.coins)),
      ledgerTotal, walletTotal, ledgerEntries: ledger.length,
      coinDays: coinFlows(ledger, fromDay, today),
      reasons: coinReasons(ledger),
      richest: [...players].sort((a, b) => b.coins - a.coins).slice(0, 15).map((p) => ({ id: p.id, name: p.name, agent: p.agent, coins: p.coins, vaultValue: p.vaultValue })),
      wealth: distribution(players.map((p) => p.coins + p.vaultValue + p.carried)),
      items: itemRows,
      claims: { total: claims.length, byStatus, byTier: claims.reduce<Record<number, number>>((acc, c) => ((acc[c.tier] = (acc[c.tier] ?? 0) + 1), acc), {}) },
      energy: bands,
      recentLedger: [...ledger].sort((a, b) => b.at - a.at).slice(0, 60).map((e) => ({ ...e, name: names.get(e.owner) ?? e.owner.slice(0, 8) })),
    },
    disciplines: DISCIPLINES,
    playersTotal: players.length,
    players: players.slice(0, MAX_PLAYERS),
  };
}

/** Everything the panel shows for one character. */
export function adminPlayer(ctx: Ctx, identity: Identity) {
  const now = nowMs(ctx);
  const id = hex(identity);
  const p = ctx.db.player.identity.find(identity);
  if (!p) throw new SenderError('no such character');
  const s = ctx.db.playStats.identity.find(identity);
  const grant = ctx.db.playerGrant.identity.find(identity);
  const skill = ctx.db.playerSkill.identity.find(identity);
  const record = <T>(kind: string, key: string): T | undefined => {
    const row = ctx.db.frontierPrivate.key.find(`${kind}:${key}`);
    return row ? (JSON.parse(row.data) as T) : undefined;
  };
  const profile = record<Profile>('profile', id);
  const meter = record<EnergyState>('energy', id);
  const containers = privateRecords<Container>(ctx, 'container').filter((c) => c.owner === id);
  const ledger = privateRecords<LedgerEntry & { id: string }>(ctx, 'ledger').filter((e) => e.owner === id).sort((a, b) => b.at - a.at);
  const activity = ctx.db.dailyActivity
    ? Array.from(ctx.db.dailyActivity.identity.filter(identity), activityRow).sort((a, b) => b.day - a.day) : [];
  const bag = Array.from(ctx.db.inventorySlot.owner.filter(identity), (row) => ({ slot: row.slot, itemId: row.itemId, quantity: row.quantity }))
    .sort((a, b) => a.slot - b.slot);
  const chat = Array.from(ctx.db.chatMessage.iter()).filter((m) => hex(m.sender) === id)
    .map((m) => ({ at: ms(m.sentAt), text: m.text })).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, 20);
  const claims = publicRecords<Claim>(ctx, 'claim').filter((c) => c.owner === id).map((c) => ({ id: c.id, tier: c.tier, status: claimStatus(c, now), paidUntil: c.paidUntil }));

  return {
    generatedAt: now, id, name: p.name, online: p.online, connections: p.connections, region: p.region || 'bramblewild',
    x: p.x, z: p.z, hp: p.hp, maxHp: p.maxHp, dead: p.state === PlayerState.Dead, weapon: p.weapon, load: p.load ?? 0,
    lastSeen: ms(p.lastSeenAt),
    grant: grant ? { agent: grant.agent, combat: grant.combat, chat: grant.chat, expiresAt: Number(grant.expiresAtMicros / 1000n) } : null,
    stats: s ? {
      firstJoin: ms(s.firstJoinAt), sessions: s.sessions, playSeconds: Math.round(Number(s.totalPlayMicros) / 1e6), deaths: s.deaths, lastStep: s.lastStep,
      milestones: { berry: ms(s.firstBerryAt), stick: ms(s.firstStickAt), hedge: ms(s.reachedHedgeAt), coast: ms(s.reachedCoastAt), craft: ms(s.firstCraftAt) },
      sessionStartedAt: ms(s.sessionStartedAt),
    } : null,
    skills: skill ? { foraging: skill.foragingXp, beachcombing: skill.beachcombingXp, crafting: skill.craftingXp } : null,
    profile: profile ? {
      coins: profile.coins, xp: Object.fromEntries(DISCIPLINES.map((d, i) => [d, profile.xp[i] ?? 0])),
      quests: profile.quests, events: profile.events, discoveries: profile.discoveries, companion: profile.companion, tame: profile.tame,
      repeatCoinsToday: profile.repeatCoins, notes: profile.notes.slice(-10),
    } : null,
    energy: meter ? energyView(meter, now) : null,
    bag, bagValue: carriedValue(bag),
    containers: containers.map((c) => ({ id: c.id, slots: c.slots.filter(Boolean), value: slotValue(c.slots) })),
    claims,
    activity,
    ledger: ledger.slice(0, 200),
    ledgerTotal: ledger.reduce((sum, e) => sum + e.amount, 0),
    chat,
  };
}
