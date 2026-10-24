import type { Identity } from 'spacetimedb';
import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { carrying } from '../lib/adventure';
import { activityAction } from '../lib/activity';
import { frontierRepository, publishOwnView } from '../lib/frontier';
import { giveItem, readSlots, writeSlots } from '../lib/inventory';
import { currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';
import { grantXp, skillLevel } from '../lib/progress';
import { refuseOnSpireFloor } from '../lib/spireGuards';
import {
  LEDGER_SEAL_ITEM_ID, LEDGER_SLOTS, Skill, countItem, getItemDef, ledgerComplete, ledgerDay, ledgerFor, nearLedgerClerk,
  removeItemCount, type LedgerState,
} from '../../../shared/sim';
import type { Ctx } from '../lib/types';

/**
 * The Island Ledger's stored part (shared/sim/ledger.ts): one private frontier
 * record per character, kind 'commissions' (the frontier's 'ledger' kind is the coin audit), `{ id: <identity hex>, day, done }`,
 * published to its owner as the frontier_view row `ledger:<hex>`. Stored like
 * the energy meter, so it works whether or not the expansion is enabled.
 */
interface LedgerRecord extends LedgerState { id: string }
interface LedgerRepo {
  get(kind: 'commissions', id: string): LedgerRecord | undefined;
  put(kind: 'commissions', value: LedgerRecord): void;
}
const ledgerRepo = (ctx: Ctx) => frontierRepository(ctx) as unknown as LedgerRepo;

function skillLevels(ctx: Ctx, id: Identity): number[] {
  return [skillLevel(ctx, id, Skill.Foraging), skillLevel(ctx, id, Skill.Beachcombing), skillLevel(ctx, id, Skill.Crafting)];
}

/**
 * Hand in one of today's three commissions at the Sunberry Market clerk: the
 * goods leave the bag, the XP goes to the commission's skill, and a ledger
 * seal (three more with the day's last slot) lands in the bag or at your feet.
 */
export const deliverCommission = spacetimedb.reducer(
  { slot: t.u8() },
  (ctx, { slot }) => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= LEDGER_SLOTS) throw new SenderError('no such commission');
    const p = requireAlivePlayer(ctx);
    refuseOnSpireFloor(p);
    if (carrying(ctx, p.identity)) throw new SenderError("Put down the giant berry first; it needs both hands");
    const T = currentTick(ctx);
    touchInput(p, T);
    if (p.hostile) throw new SenderError('Not while fighting');
    const nowMs = Number(ctx.timestamp.microsSinceUnixEpoch / 1000n);
    const regionProfile = ctx.db.frontierPrivate.key.find(`profile:${p.identity.toHexString()}`);
    if (regionProfile && nowMs < (JSON.parse(regionProfile.data).events?.hostileUntil ?? 0)) {
      throw new SenderError('Not while fighting');
    }
    if (!nearLedgerClerk(p)) throw new SenderError('Hand commissions in at a ledger clerk: the Sunberry Market, Crossroads, Kingsgate or Fenhold');

    const idHex = p.identity.toHexString();
    const day = ledgerDay(nowMs);
    const repo = ledgerRepo(ctx);
    const stored = repo.get('commissions', idHex);
    const commission = ledgerFor(idHex, day, skillLevels(ctx, p.identity), stored)[slot];
    const reward = ledgerComplete(commission, stored, day);
    if (!reward) throw new SenderError('That commission is already done today');

    const snap = readSlots(ctx, p.identity);
    const have = countItem(snap.slots, commission.itemId);
    if (have < commission.quantity) {
      const name = getItemDef(commission.itemId)?.name ?? commission.itemId;
      throw new SenderError(`Bring ${commission.quantity} ${name} (you have ${have})`);
    }
    writeSlots(ctx, p.identity, snap, removeItemCount(snap.slots, commission.itemId, commission.quantity));

    const record: LedgerRecord = { id: idHex, day: reward.state.day, done: reward.state.done };
    repo.put('commissions', record);
    publishOwnView(ctx, p.identity, 'ledger', idHex, record);

    grantXp(ctx, p.identity, reward.skill as Skill, reward.xp);
    giveItem(ctx, p.identity, LEDGER_SEAL_ITEM_ID, reward.seals, p, T);
    savePlayer(ctx, p);
    activityAction(ctx, p.identity, 'ledger');
  }
);
