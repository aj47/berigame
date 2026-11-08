import type { WatchPass } from '../spacetime/viewer';

/**
 * The tab's pass, kept across reloads. Every pass is a `spectator` row that lasts its full lifetime and a world holds
 * MAX_SPECTATORS of them, so a page that minted a new pass on every reload (offline for five minutes, a render crash
 * every few seconds) would fill the world for two days. sessionStorage is per tab, so each OBS source keeps its own.
 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const keyFor = (world: string) => `berigame.watchPass:${world}`;
const session = (): Store | null => { try { return window.sessionStorage; } catch { return null; } };

/** The kept pass, if it is well-formed and has more than `minLeftMs` to run. */
export function keptPass(world: string, minLeftMs: number, now = Date.now(), store: Store | null = session()): WatchPass | null {
  try {
    const pass = JSON.parse(store?.getItem(keyFor(world)) ?? 'null') as WatchPass | null;
    if (!pass?.token || !pass.uri || !pass.database || !(Date.parse(pass.expiresAt) - now > minLeftMs)) return null;
    return pass;
  } catch { return null; }
}

export function keepPass(world: string, pass: WatchPass | null, store: Store | null = session()): void {
  try {
    if (pass) store?.setItem(keyFor(world), JSON.stringify(pass));
    else store?.removeItem(keyFor(world));
  } catch { /* storage full or blocked: the next reload asks for a new pass */ }
}
