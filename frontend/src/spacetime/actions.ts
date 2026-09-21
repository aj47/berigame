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
    setStance: (stance: number) => run('setStance', (c) => c.reducers.setStance({ stance })),
    attack: (target: Identity) => run('attack', (c) => c.reducers.attack({ target })),
    follow: (target: Identity) => run('follow', (c) => c.reducers.follow({ target })),
    startHarvest: (treeId: number) => run('startHarvest', (c) => c.reducers.startHarvest({ treeId })),
    eatBerry: (slot: number) => run('eatBerry', (c) => c.reducers.eatBerry({ slot })),
    moveItem: (from: number, to: number) => run('moveItem', (c) => c.reducers.moveItem({ from, to })),
    dropItem: (slot: number, quantity: number) => run('dropItem', (c) => c.reducers.dropItem({ slot, quantity })),
    pickupItem: (id: bigint) => run('pickupItem', (c) => c.reducers.pickupItem({ id })),
    sendChat: (text: string) => run('sendChat', (c) => c.reducers.sendChat({ text })),
    setAppearance: (appearance: Appearance) => run('setAppearance', (c) => c.reducers.setAppearance(appearance)),
    setName: (name: string) => run('setName', (c) => c.reducers.setName({ name })),
  };
}
