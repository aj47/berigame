/** What a /watch URL asks for. Pure: nothing here reaches a server, and no parameter can start an action. */
export type WatchMode = 'follow' | 'overview' | 'director';

export interface WatchParams {
  mode: WatchMode;
  /** follow: identity hex, or a character name. */
  player: string | null;
  /** Broadcast delay. */
  delayMs: number;
  /** Origin of the world's gateway; same origin when absent. */
  world: string | null;
  /** The world's watch key, when it has one. */
  key: string | null;
  graphics: 'low' | 'medium' | 'high';
  /** Frame cap: one OBS source should not spend a whole GPU. */
  fps: number;
  /** Off by default, or every OBS source would play over the others. */
  audio: boolean;
  /** director: shortest time on one player. */
  holdMs: number;
}

export const MAX_DELAY_SECONDS = 600;
export const DEFAULT_HOLD_SECONDS = 8;

const number = (value: string | null, fallback: number, min: number, max: number) => {
  const n = value === null || value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function gatewayOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch { return null; }
}

export function parseWatchParams(search: string): WatchParams {
  const q = new URLSearchParams(search);
  const player = q.get('player')?.trim().slice(0, 80) || null;
  const asked = q.get('mode');
  const mode: WatchMode = asked === 'overview' || asked === 'director' ? asked : player ? 'follow' : 'overview';
  const graphics = q.get('graphics');
  return {
    mode, player,
    delayMs: number(q.get('delay'), 0, 0, MAX_DELAY_SECONDS) * 1000,
    world: gatewayOrigin(q.get('world')) ?? gatewayOrigin((import.meta as any).env?.VITE_WATCH_WORLD ?? null),
    key: q.get('key') || null,
    graphics: graphics === 'low' || graphics === 'high' ? graphics : 'medium',
    fps: number(q.get('fps'), 30, 5, 60),
    audio: q.get('audio') === '1',
    holdMs: number(q.get('hold'), DEFAULT_HOLD_SECONDS, 3, 120) * 1000,
  };
}

const HEX = /^(?:0x)?([0-9a-fA-F]{64})$/;

/** The identity hex `query` names among `rows`: an identity outright, otherwise an exact name (any case). */
export function resolvePlayer(query: string, rows: Iterable<{ identity: { toHexString(): string }; name: string }>): string | null {
  const hex = HEX.exec(query)?.[1];
  if (hex) return hex.toLowerCase();
  const wanted = query.toLowerCase();
  for (const row of rows) if (row.name.toLowerCase() === wanted) return row.identity.toHexString();
  return null;
}
