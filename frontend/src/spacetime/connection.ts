import { DbConnection, tables } from '../module_bindings';
import { useLoadingStore } from '../store';

import { readSessionToken, sessionTokenKey, visiblyInvalidToken } from './sessionToken';

const env = (import.meta as any).env ?? {};
export const SPACETIME_URI: string = env.VITE_SPACETIME_URI ?? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.hostname}:3000`;
export const SPACETIME_DB: string = env.VITE_SPACETIME_DB ?? 'berigame';
export const TOKEN_KEY = sessionTokenKey(SPACETIME_URI, SPACETIME_DB);

function readToken(): string | undefined {
  try {
    return readSessionToken(localStorage, SPACETIME_URI, SPACETIME_DB);
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
  const savedToken = readToken();
  return DbConnection.builder()
    .withUri(SPACETIME_URI)
    .withDatabaseName(SPACETIME_DB)
    .withToken(savedToken)
    .onConnect((conn, identity, token) => {
      saveToken(token);
      useLoadingStore.getState().setConnectionIssue(null, false);
      console.log('SpacetimeDB connected as', identity.toHexString().slice(0, 8));
      useLoadingStore.getState().setWebsocketConnected(true);
      conn
        .subscriptionBuilder()
        .onApplied(() => useLoadingStore.getState().setGameDataLoaded(true))
        .onError((_ctx, err) => {
          console.error('World subscription failed');
          useLoadingStore.getState().setGameDataLoaded(false);
          useLoadingStore.getState().setLoadingMessage('The world could not be loaded. Rejoin to try again.');
        })
        .subscribe([
          tables.world,
          tables.player,
          tables.appearance,
          tables.tree,
          tables.groundItem,
          tables.chatMessage,
          tables.inventorySlot,
          tables.combatEvent,
        ]);
    })
    .onConnectError((_ctx, err) => {
      console.error('Game server connection failed');
      useLoadingStore.getState().setWebsocketConnected(false);
      useLoadingStore.getState().setConnectionIssue(
        visiblyInvalidToken(savedToken)
          ? 'Your saved sign-in is invalid or expired. Rejoin to retry, or use sign-in recovery below.'
          : 'Cannot reach the game server. Rejoin to try again.',
        Boolean(savedToken),
      );
    })
    .onDisconnect(() => {
      console.warn('SpacetimeDB disconnected');
      useLoadingStore.getState().setWebsocketConnected(false);
      useLoadingStore.getState().setGameDataLoaded(false);
    });
}
