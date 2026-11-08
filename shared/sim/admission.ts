/** Per-world safety bounds, not measured production capacity. IPs are not players. */
export const MAX_ONLINE_PLAYERS = 2048;
export const MAX_CHARACTER_CONNECTIONS = 4;
export const MAX_STORED_CHARACTERS = 100_000;
/** Live read-only viewers per world (/watch): each holds a whole-world feed, unlike a player's area subscription. */
export const MAX_SPECTATORS = 32;
/** A spectator pass: long enough to outlast a 24-hour broadcast before it needs replacing. */
export const SPECTATOR_PASS_SECONDS = 48 * 3600;
/** Sockets one pass may hold at once: the page's own reconnect can briefly overlap its old socket. */
export const MAX_SPECTATOR_CONNECTIONS = 2;

/** A saved permit alone never occupies an online slot. */
export function hasWorldSpace(players: Iterable<{ online: boolean }>, alreadyOnline = false): boolean {
  if (alreadyOnline) return true;
  let online = 0;
  for (const player of players) if (player.online && ++online >= MAX_ONLINE_PLAYERS) return false;
  return true;
}

/** A character with no game input for this long is logged out until its player chooses to return. */
export const IDLE_LOGOUT_MINUTES = 15;
