import type { Appearance } from '@sim';
import { useCallback } from 'react';
import { useSpacetimeDB } from 'spacetimedb/react';
import type { Identity } from 'spacetimedb';
import type { DbConnection } from '../module_bindings';
import { useToastStore } from './stores/toastStore';
import { useLoadingStore } from '../store';

/**
 * Typed wrappers around the module's reducers. Every rejected call surfaces
 * its reason as a toast instead of an unhandled promise rejection.
 */
export function useGameActions() {
  const { getConnection } = useSpacetimeDB<DbConnection>();
  const show = useToastStore((s) => s.show);

  const run = useCallback(
    async (label: string, fn: (conn: DbConnection) => Promise<unknown>) => {
      const loading = useLoadingStore.getState();
      if (!navigator.onLine || loading.worldUpdatesStalled || !loading.websocketConnected || !loading.gameDataLoaded) {
        show('Waiting for live world updates');
        return false;
      }
      const conn = getConnection();
      if (!conn) {
        show('Not connected');
        return false;
      }
      try {
        await fn(conn);
        return true;
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? 'rejected');
        console.warn(`${label} rejected:`, msg);
        show(msg);
        return false;
      }
    },
    [getConnection, show]
  );

  return {
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
    pickupItem: (id: bigint) => run('pickupItem', (c) => c.reducers.pickupItem({ id })),
    sendChat: (text: string) => run('sendChat', (c) => c.reducers.sendChat({ text })),
    setAppearance: (appearance: Appearance) => run('setAppearance', (c) => c.reducers.setAppearance(appearance)),
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
    confirmTrade: (tradeId: bigint, aOffer: string, bOffer: string) => run('confirmTrade', (c) => c.reducers.confirmTrade({ tradeId, aOffer, bOffer })),
    cancelTrade: (tradeId: bigint) => run('cancelTrade', (c) => c.reducers.cancelTradeRequest({ tradeId })),
  };
}
