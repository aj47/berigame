/** Per-world safety bounds, not measured production capacity. IPs are not players. */
export const MAX_ONLINE_PLAYERS = 256;
export const MAX_CHARACTER_CONNECTIONS = 4;
export const MAX_STORED_CHARACTERS = 10_000;

/** A saved permit alone never occupies an online slot. */
export function hasWorldSpace(players: Iterable<{ online: boolean }>, alreadyOnline = false): boolean {
  if (alreadyOnline) return true;
  let online = 0;
  for (const player of players) if (player.online && ++online >= MAX_ONLINE_PLAYERS) return false;
  return true;
}
