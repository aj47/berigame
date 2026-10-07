import { recordDiagnostic } from './diagnostics';
import { PLAYER_ACTION } from '../frontier/worldInteraction';
import { normalizeAppearance, SPIRE_RULES_VERSION, type Appearance } from '@sim';
import { useCallback } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import type { Identity } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { useToastStore } from './stores/toastStore';
import { useLoadingStore } from '../store';
import { ConnectionLostError, trackCall } from './pendingCalls';

/**
 * Typed wrappers around the module's reducers. Every rejected call surfaces
 * its reason as a toast instead of an unhandled promise rejection.
 */
export function useGameActions() {
  const { getConnection } = useSpacetimeDB<DbConnection>();
  const show = useToastStore((s) => s.show);

  const run = useCallback(
    async (label: string, fn: (conn: DbConnection) => Promise<unknown>) => {
      window.dispatchEvent(new Event(PLAYER_ACTION));
      const loading = useLoadingStore.getState();
      if (!navigator.onLine || loading.worldUpdatesStalled || !loading.websocketConnected || !loading.gameDataLoaded) {
        recordDiagnostic('action', { action: label, outcome: 'waiting-for-world' });
        show('Waiting for live world updates');
        return false;
      }
      const conn = getConnection();
      if (!conn) {
        recordDiagnostic('action', { action: label, outcome: 'not-connected' });
        show('Not connected');
        return false;
      }
      const started = performance.now();
      recordDiagnostic('action', { action: label, outcome: 'started' });
      try {
        await trackCall(fn(conn));
        recordDiagnostic('action', { action: label, outcome: 'accepted', durationMs: Math.round(performance.now() - started) });
        return true;
      } catch (e: any) {
        recordDiagnostic('action', { action: label, outcome: e instanceof ConnectionLostError ? 'connection-lost' : 'rejected', durationMs: Math.round(performance.now() - started) });
        if (e instanceof ConnectionLostError) {
          show('Connection lost — reconnecting');
          return false;
        }
        const msg = String(e?.message ?? e ?? 'rejected');
        console.warn(`${label} rejected:`, msg);
        show(msg);
        return false;
      }
    },
    [getConnection, show]
  );

  return {
    frontier: (command: import("../../../shared/sim/frontier/engine").Command) => run(`frontier:${command.action}`, c => c.reducers.frontierAction({ command: JSON.stringify(command) })),
    equipTechnique: (technique: number) => run('technique', c => c.reducers.equipTechnique({ technique })),
    expeditionAction: (action: string, expeditionId = 0n, extra: { target?: Identity; x?: number; z?: number; destination?: string } = {}) => run('expedition', c => c.reducers.expeditionAction({ action, expeditionId, target: extra.target, x: extra.x ?? 35, z: extra.z ?? 37, destination: extra.destination ?? 'market' })),
    contributeProject: (itemId: string) => run('project', c => c.reducers.contributeProject({ itemId })),
    shareGarden: (shared: boolean) => run('shareGarden', c => c.reducers.shareGarden({ shared })),
    duelAction: (action: string, target: Identity) => run('duel', c => c.reducers.duelAction({ action, target })),
    setTarget: (x: number, z: number) => run('setTarget', (c) => c.reducers.setTarget({ x, z })),
    cancel: () => run('cancel', (c) => c.reducers.cancel()),
    attack: (target: Identity) => run('attack', (c) => c.reducers.attack({ target })),
    follow: (target: Identity) => run('follow', (c) => c.reducers.follow({ target })),
    startHarvest: (treeId: number) => run('startHarvest', (c) => c.reducers.startHarvest({ treeId })),
    eatBerry: (slot: number) => run('eatBerry', (c) => c.reducers.eatBerry({ slot })),
    /** Wield the weapon in quick slot 0..HOTBAR_SIZE-1; the server rejects anything else. */
    wieldItem: (slot: number) => run('wieldItem', (c) => c.reducers.wieldItem({ slot })),
    /** Put the weapon away and go back to punching. */
    unwield: () => run('unwield', (c) => c.reducers.unwield({})),
    moveItem: (from: number, to: number) => run('moveItem', (c) => c.reducers.moveItem({ from, to })),
    dropItem: (slot: number, quantity: number) => run('dropItem', (c) => c.reducers.dropItem({ slot, quantity })),
    vaultDeposit: (itemId: string, quantity: number) => run('vaultDeposit', (c) => c.reducers.vaultDeposit({ itemId, quantity })),
    vaultWithdraw: (itemId: string, quantity: number) => run('vaultWithdraw', (c) => c.reducers.vaultWithdraw({ itemId, quantity })),
    pickupItem: (id: bigint) => run('pickupItem', (c) => c.reducers.pickupItem({ id })),
    sendChat: (text: string) => run('sendChat', (c) => c.reducers.sendChat({ text })),
    setAppearance: (appearance: Appearance) => run('setAppearance', (c) => c.reducers.setAppearance(appearance)),
    saveCharacter: (name: string, appearance: Appearance) => run('saveCharacter', (c) => c.reducers.saveCharacter({ name, ...normalizeAppearance(appearance) })),
    setName: (name: string) => run('setName', (c) => c.reducers.setName({ name })),
    /** The verb "make": craft a recipe from shared/sim RECIPES (e.g. 'stone_club'). */
    /** Walk up to a training dummy and keep swinging at it (open to everyone, harms nobody). */
    attackDummy: (dummyId: number) => run('attackDummy', (c) => c.reducers.attackDummy({ dummyId })),
    /** A cosmetic emote (shared/sim Emote), seen by everyone nearby. */
    emote: (emote: number) => run('emote', (c) => c.reducers.emote({ emote })),
    craft: (recipe: string) => run('craft', (c) => c.reducers.craft({ recipe })),
    // Social: invite links, friends, trades (shared/sim friends.ts, trade.ts).
    createInvite: () => run('createInvite', (c) => c.reducers.createInvite({})),
    redeemInvite: (code: string) => run('redeemInvite', (c) => c.reducers.redeemInvite({ code })),
    addFriend: (target: Identity) => run('addFriend', (c) => c.reducers.addFriend({ target })),
    removeFriend: (target: Identity) => run('removeFriend', (c) => c.reducers.removeFriend({ target })),
    requestTrade: (target: Identity) => run('requestTrade', (c) => c.reducers.requestTrade({ target })),
    respondTrade: (tradeId: bigint, accept: boolean) => run('respondTrade', (c) => c.reducers.respondTrade({ tradeId, accept })),
    setTradeOffer: (tradeId: bigint, offer: string) => run('setTradeOffer', (c) => c.reducers.setTradeOffer({ tradeId, offer })),
    setTradeCoins: (tradeId: bigint, coins: number) => run('setTradeCoins', c => c.reducers.setTradeCoins({ tradeId, coins })),
    confirmTrade: (tradeId: bigint, aOffer: string, bOffer: string, aCoins = 0, bCoins = 0) => run('confirmTrade', (c) => aCoins || bCoins ? c.reducers.confirmTradeCoins({ tradeId, aOffer, bOffer, aCoins, bCoins }) : c.reducers.confirmTrade({ tradeId, aOffer, bOffer })),
    cancelTrade: (tradeId: bigint) => run('cancelTrade', (c) => c.reducers.cancelTradeRequest({ tradeId })),
    /** Walk up to the Giant and keep swinging at it (open to everyone; needs the stone club to reach the Boulders). */
    attackGiant: (giantId: number) => run('attackGiant', (c) => c.reducers.attackGiant({ giantId })),
    /** Wear an earned cosmetic (shared/sim CosmeticSlot; cosmetic id + 1, 0 = take it off). */
    wearCosmetic: (slot: number, cosmetic: number) => run('wearCosmetic', (c) => c.reducers.wearCosmetic({ slot, cosmetic })),
    /** Personal garden: plant one berry in a plot / harvest a ripe plot (stand within reach of it). */
    plantGarden: (plot: number, itemId: string) => run('plantGarden', (c) => c.reducers.plantGarden({ plot, itemId })),
    harvestGarden: (plot: number) => run('harvestGarden', (c) => c.reducers.harvestGarden({ plot })),
    // Bosses. The Spire calls pass this bundle's rules version, so an older tab is refused instead of drawing other bullets.
    /** Walk up to Clatterhorn in its glade and keep swinging (open to everyone; needs a stick to reach the Coast). */
    attackClatterhorn: () => run('attackClatterhorn', (c) => c.reducers.attackClatterhorn({})),
    /** Open a public Sunken Spire lobby at the gate (you lead it). */
    spireOpen: () => run('spireOpen', (c) => c.reducers.spireOpen({ clientRules: SPIRE_RULES_VERSION })),
    /** Join a lobby by run id, or quick-join an open one with 0n. */
    spireJoin: (runId: bigint = 0n) => run('spireJoin', (c) => c.reducers.spireJoin({ runId, clientRules: SPIRE_RULES_VERSION })),
    /** Leave a lobby, or forfeit a run (no rewards). */
    spireLeave: () => run('spireLeave', (c) => c.reducers.spireLeave({})),
    /** Leader: start the run (every member's spire key is spent). */
    spireStart: () => run('spireStart', (c) => c.reducers.spireStart({ clientRules: SPIRE_RULES_VERSION })),
  };
}
