import { t, SenderError } from 'spacetimedb/server';
import spacetimedb from '../schema';
import { DROP_BOX_DEPOSIT_TICKS, Pending, atGroveVault, countItem, dropBoxInReach, getItemDef } from '../../../shared/sim';
import { carrying } from '../lib/adventure';
import { readSlots } from '../lib/inventory';
import { clearInteractions, currentTick, requireAlivePlayer, savePlayer, touchInput } from '../lib/players';
import { refuseOnSpireFloor } from '../lib/spireGuards';
import { clearDeposit, moveVaultItems } from '../lib/vault';

function requireQuantity(itemId: string, quantity: number): void {
  if (!getItemDef(itemId)) throw new SenderError('Unknown item');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new SenderError('Choose 1 to 99 items');
}

/**
 * Put items in your personal vault. In the Grove's safe ring it is instant.
 * At a Coast drop box it takes DROP_BOX_DEPOSIT_TICKS; moving, another action
 * or any damage stops it (the tick finishes it).
 */
export const vaultDeposit = spacetimedb.reducer(
  { itemId: t.string(), quantity: t.u8() },
  (ctx, { itemId, quantity }) => {
    requireQuantity(itemId, quantity);
    const p = requireAlivePlayer(ctx);
    refuseOnSpireFloor(p);
    if (carrying(ctx, p.identity)) throw new SenderError('Put down the giant berry first; it needs both hands');
    const T = currentTick(ctx);
    touchInput(p, T);
    if (atGroveVault(p)) {
      const result = moveVaultItems(ctx, p, itemId, quantity, 'deposit');
      if (!result.ok) throw new SenderError(result.reason);
      savePlayer(ctx, p);
      return;
    }
    const box = dropBoxInReach(p);
    if (!box) throw new SenderError('Bank in the Grove safe ring, or stand beside a Coast drop box');
    if (countItem(readSlots(ctx, p.identity).slots, itemId) < quantity) throw new SenderError(`You do not have ${quantity} ${getItemDef(itemId)!.name}`);
    clearInteractions(ctx, p);
    clearDeposit(ctx, p.identity);
    ctx.db.pendingDeposit.insert({ identity: p.identity, boxId: box.id, itemId, quantity, doneTick: T + DROP_BOX_DEPOSIT_TICKS });
    p.pending = Pending.Deposit;
    p.pendingId = BigInt(box.id);
    savePlayer(ctx, p);
  }
);

/** Take items out of your vault: only in the Grove's safe ring (or the Meadows town bank). */
export const vaultWithdraw = spacetimedb.reducer(
  { itemId: t.string(), quantity: t.u8() },
  (ctx, { itemId, quantity }) => {
    requireQuantity(itemId, quantity);
    const p = requireAlivePlayer(ctx);
    touchInput(p, currentTick(ctx));
    if (!atGroveVault(p)) throw new SenderError('Withdraw in the Grove safe ring; drop boxes only take deposits');
    const result = moveVaultItems(ctx, p, itemId, quantity, 'withdraw');
    if (!result.ok) throw new SenderError(result.reason);
    savePlayer(ctx, p);
  }
);
