import type { Identity } from 'spacetimedb';
import { emptyVaultSlots, getItemDef, inHotbar, vaultId, vaultTransfer, type VaultTransfer } from '../../../shared/sim';
import { FRONTIER } from '../../../shared/sim/frontier/catalog';
import type { Container } from '../../../shared/sim/frontier/model';
import { frontierRepository, publishOwnView } from './frontier';
import { readSlots, writeSlots } from './inventory';
import { activity, activityAction } from './activity';
import type { Ctx, PlayerRow } from './types';

/**
 * Move items between a player's bag and their personal vault: the frontier's
 * `vault-<id>` container, so the Grove vault and the Meadows town bank are the
 * same storage. Mutates `p.weapon` when a deposit takes the wielded weapon's last
 * quick-bar copy; the caller saves `p`. Returns the rule's verdict.
 */
export function moveVaultItems(ctx: Ctx, p: PlayerRow, itemId: string, quantity: number, direction: 'deposit' | 'withdraw'): VaultTransfer {
  const repo = frontierRepository(ctx);
  const id = vaultId(p.identity.toHexString());
  const stored = repo.get('container', id);
  const vault: Container = stored ?? { id, owner: p.identity.toHexString(), slots: emptyVaultSlots() };
  // Grow a legacy vault, keeping every occupied slot (as the town bank does).
  if (vault.slots.length < FRONTIER.bankSlots) vault.slots = [...vault.slots, ...Array(FRONTIER.bankSlots - vault.slots.length).fill(null)];
  const snap = readSlots(ctx, p.identity);
  const result = vaultTransfer(snap.slots, vault.slots, itemId, quantity, direction);
  if (!result.ok) return result;
  writeSlots(ctx, p.identity, snap, result.bag);
  const next = { ...vault, slots: result.vault };
  repo.put('container', next);
  publishOwnView(ctx, p.identity, 'container', id, next);
  if (p.weapon && !inHotbar(result.bag, p.weapon)) p.weapon = '';
  if (direction === 'deposit') activity(ctx, p.identity, 'deposits');
  else activityAction(ctx, p.identity, 'vault-withdraw');
  return result;
}

export function itemLabel(itemId: string, quantity: number): string {
  const name = getItemDef(itemId)?.name ?? itemId;
  return quantity === 1 ? name : `${quantity} ${name}`;
}

export function clearDeposit(ctx: Ctx, id: Identity): void {
  if (ctx.db.pendingDeposit?.identity.find(id)) ctx.db.pendingDeposit.identity.delete(id);
}
