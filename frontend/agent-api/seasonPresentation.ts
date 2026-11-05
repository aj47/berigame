import {
  FIRST_TIER_KIND, LEDGER_CLERKS, LEDGER_FULL_BONUS_SEALS, LEDGER_RANGE, LEDGER_SEAL_ITEM_ID, LEDGER_SEALS, LEDGER_SLOTS, NODE_KINDS, SKILLS, TIER_BIOMES, TIER_NODES,
  countItem, getItemDef, harvestXp, ledgerDay, ledgerFor, ledgerResetInMs, nearLedgerClerk, nearestLedgerClerk, nodeLevelRejection, nodeMinLevel, skillForNode, tierNode,
  type LedgerState, type Slot, type Tile,
} from '../../shared/sim';

/**
 * The Long Season's blocks of /state and WebMCP's inspect_game_state: node level gates, the node kind table and
 * the daily Island Ledger. Pure, so the gateway and the browser present the same JSON from their own caches.
 */

/** Agent-facing names of shared/sim NodeKind, indexed by kind: the original four, then season.ts TIER_NODES keys. */
export const NODE_KIND_NAMES: readonly string[] = ['berry', 'driftwood', 'tide_rock', 'obsidian', ...TIER_NODES.map(d => d.key)];

/** Levels in skill-id order: [foraging, beachcombing, crafting]. */
export type SkillLevels = readonly number[];
const skillKey = (skill: number) => SKILLS[skill]?.key ?? 'foraging';

/** The level fields of one node in state.nodes: which skill it trains, the level it needs, XP per harvest, and whether you are below it. */
export function nodeLevelInfo(kind: number | undefined, levels: SkillLevels) {
  const skill = skillForNode(kind);
  const minLevel = nodeMinLevel(kind);
  return { skill: skillKey(skill), minLevel, xp: harvestXp(kind), locked: (levels[skill] ?? 1) < minLevel };
}

/** Why you cannot work this node yet (the server's own words, e.g. "Needs Foraging level 30"), or null. */
export function nodeLockReason(kind: number | undefined, levels: SkillLevels): string | null {
  return nodeLevelRejection(kind, levels[skillForNode(kind)] ?? 1);
}

/** Every node kind once (state.nodeKinds), so the per-node rows stay small. */
export function describeNodeKinds(levels: SkillLevels) {
  return NODE_KIND_NAMES.map((key, kind) => {
    const def = NODE_KINDS[kind as keyof typeof NODE_KINDS];
    const tier = tierNode(kind);
    return {
      kind: key, name: def?.name ?? key, ...nodeLevelInfo(kind, levels), harvestTicks: def?.harvestTicks ?? 0, regrowTicks: def?.regrowTicks ?? 0,
      ...(tier ? { tier: tier.tier, gives: { itemId: tier.itemId, name: getItemDef(tier.itemId)?.name ?? tier.itemId },
        biomes: [...TIER_BIOMES[tier.tier - 1]] } : {}),
    };
  });
}

/** The node kind for a harvest `kind` argument, or -1. */
export function nodeKindOf(name: string): number {
  return NODE_KIND_NAMES.indexOf(name);
}
export const isTierKind = (kind: number) => kind >= FIRST_TIER_KIND;

/** Your stored ledger progress: the frontier_view row kind 'ledger', source `ledger:<hex>`, data {id, day, done}. */
export function ledgerStateOf(views: Iterable<{ kind: string; source: string; data: string }>, identity: string): LedgerState | undefined {
  for (const row of views) {
    if (row.kind !== 'ledger' || row.source !== `ledger:${identity}`) continue;
    try {
      const data = JSON.parse(row.data) as { day?: unknown; done?: unknown };
      if (typeof data.day === 'number' && typeof data.done === 'number') return { day: data.day, done: data.done };
    } catch { /* a malformed row counts as nothing done */ }
  }
  return undefined;
}

export interface LedgerInput {
  identity: string;
  levels: SkillLevels;
  views: Iterable<{ kind: string; source: string; data: string }>;
  slots: readonly Slot[];
  self: Tile;
  now: number;
}

/** state.ledger: today's three commissions (ledgerFor), what you hold toward each, and where to hand them in. */
export function describeLedger(input: LedgerInput) {
  const day = ledgerDay(input.now);
  const commissions = ledgerFor(input.identity, day, input.levels, ledgerStateOf(input.views, input.identity));
  return {
    day,
    resetsInSeconds: Math.ceil(ledgerResetInMs(input.now) / 1000),
    // clerk: the nearest one to you (any clerk takes any commission); clerks: all of them.
    clerk: (({ x, z }) => ({ x, z }))(nearestLedgerClerk(input.self)),
    clerks: LEDGER_CLERKS.map(c => ({ id: c.id, name: c.name, tile: { x: c.x, z: c.z } })),
    range: LEDGER_RANGE, nearClerk: nearLedgerClerk(input.self),
    commissions: commissions.map(c => {
      const have = countItem(input.slots, c.itemId);
      return { slot: c.slot, id: c.id, itemId: c.itemId, name: getItemDef(c.itemId)?.name ?? c.itemId, quantity: c.quantity, have,
        skill: skillKey(c.skill), xp: c.xp, done: c.done, ready: !c.done && have >= c.quantity };
    }),
    finished: commissions.filter(c => c.done).length,
    seals: { itemId: LEDGER_SEAL_ITEM_ID, held: countItem(input.slots, LEDGER_SEAL_ITEM_ID), perCommission: LEDGER_SEALS, fullLedgerBonus: LEDGER_FULL_BONUS_SEALS },
    rule: `Three commissions a day (UTC), drawn for your levels. Bring the goods in your bag to any ledger clerk (${LEDGER_CLERKS.map(c => `${c.name} ${c.x},${c.z}`).join('; ')}; within Chebyshev ${LEDGER_RANGE}; clerk is the nearest) and send deliver_commission with the slot. Each pays its XP to the listed skill and ${LEDGER_SEALS} ledger seal; finishing all ${LEDGER_SLOTS} adds ${LEDGER_FULL_BONUS_SEALS} more. Seals only come from the ledger and go into the season's seal recipes.`,
  };
}

/** Why a delivery cannot go through yet, checked before the reducer so the error is specific. */
export function deliveryProblem(ledger: ReturnType<typeof describeLedger>, slot: number): { status: number; code: string; message: string } | null {
  const c = ledger.commissions.find(entry => entry.slot === slot);
  if (!c) return { status: 400, code: 'invalid_arguments', message: `Choose a commission slot from 0 to ${LEDGER_SLOTS - 1}.` };
  if (c.done) return { status: 409, code: 'commission_done', message: 'That commission is already finished today.' };
  if (c.have < c.quantity) return { status: 422, code: 'commission_items', message: `Bring ${c.quantity} ${c.name} in your bag (you have ${c.have}).` };
  return null;
}

/** A reducer refusal that names a missing skill level ("Needs Foraging level 30") becomes level_required with that text. */
export function levelError(error: unknown): { status: 422; code: 'level_required'; message: string } | null {
  const match = /Needs (Foraging|Beachcombing|Crafting) level \d+/.exec(String((error as Error)?.message ?? error));
  return match ? { status: 422, code: 'level_required', message: match[0] } : null;
}
