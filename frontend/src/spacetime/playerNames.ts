import { useSyncExternalStore } from 'react';

/*
 * Every name this client has seen, by identity hex. Player rows are only
 * subscribed near you (interestSubscription.ts), so a chat line, friend or
 * plot owner can name someone whose row is not in the cache; the interest
 * manager feeds every player row it sees in here and looks unknown chat
 * senders up once. Names change rarely (`/name`), so a remembered name is good
 * enough after its row leaves your block.
 */
let names = new Map<string, string>();
const listeners = new Set<() => void>();
let scheduled = false;

function notify(): void {
  if (scheduled) return;
  scheduled = true;
  // One snapshot per burst (a block arriving inserts many rows at once).
  queueMicrotask(() => {
    scheduled = false;
    names = new Map(names);
    for (const l of [...listeners]) l();
  });
}

export function notePlayerName(hex: string, name: string | undefined): void {
  if (!name || names.get(hex) === name) return;
  names.set(hex, name);
  notify();
}

export function playerName(hex: string): string | undefined {
  return names.get(hex);
}

/** For tests. */
export function resetPlayerNames(): void {
  names = new Map();
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => names;

/** Names by identity hex, re-rendering when any new name arrives. */
export function usePlayerNames(): ReadonlyMap<string, string> {
  return useSyncExternalStore(subscribe, snapshot);
}
