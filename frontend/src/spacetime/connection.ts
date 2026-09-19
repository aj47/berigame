import { DbConnection, tables } from '../module_bindings';
import { useLoadingStore } from '../store';

export const TOKEN_KEY = 'berigame_stdb_token';

const env = (import.meta as any).env ?? {};
export const SPACETIME_URI: string = env.VITE_SPACETIME_URI ?? 'ws://localhost:3000';
export const SPACETIME_DB: string = env.VITE_SPACETIME_DB ?? 'berigame';

function readToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* private mode etc. */
  }
}

/**
 * One connection builder for the whole app. The token persisted in
 * localStorage is what gives a browser a stable identity across refreshes,
 * which is what keeps its HP and inventory.
 */
export function buildConnection() {
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB)
    .withToken(readToken())
    .onConnect((conn, identity, token) => {
      saveToken(token);
      console.log('SpacetimeDB connected as', identity.toHexString().slice(0, 8));
      useLoadingStore.getState().setWebsocketConnected(true);
      conn
        .subscriptionBuilder()
        .onApplied(() => useLoadingStore.getState().setGameDataLoaded(true))
        .onError((_ctx, err) => console.error('subscription error', err))
        .subscribe([
          tables.world,
          tables.player,
          tables.tree,
          tables.groundItem,
          tables.chatMessage,
          tables.inventorySlot,
          tables.combatEvent,
        ]);
    })
    .onConnectError((_ctx, err) => {
      console.error('SpacetimeDB connect error', err);
      useLoadingStore.getState().setWebsocketConnected(false);
    })
    .onDisconnect(() => {
      console.warn('SpacetimeDB disconnected');
      useLoadingStore.getState().setWebsocketConnected(false);
      useLoadingStore.getState().setGameDataLoaded(false);
    });
}
