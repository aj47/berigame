import { Identity } from 'spacetimedb';
import { identityKey32 } from '@sim';

/**
 * Player lookups Clatterhorn's client needs and the boss store does not hold:
 * a swinger's weapon (for other players' swing cues) and the identity of the
 * charge's bait (`row.bait` is only a 32-bit key). The connected Clatterhorn
 * component installs a source backed by the live connection's player cache;
 * without one (tests, previews) every lookup is empty.
 */
export interface ClatterPlayerSource {
  /** The player's wielded weapon item id ('' = fists), or null when unknown. */
  weaponOf(hex: string): string | null;
  /** Identity hexes of every loaded player, in any order. */
  hexes(): Iterable<string>;
}

let source: ClatterPlayerSource | null = null;
let baitKey = 0;
let baitHex: string | null = null;

/** Install the lookup source; returns the uninstaller (which only removes this source). */
export function setClatterPlayerSource(next: ClatterPlayerSource | null): () => void {
  source = next;
  baitKey = 0; baitHex = null;
  return () => { if (source === next) { source = null; baitKey = 0; baitHex = null; } };
}

export function clatterWeaponOf(hex: string): string | null {
  return source?.weaponOf(hex) ?? null;
}

/**
 * The identity hex whose `identityKey32` equals `key` (0 = none). One scan of
 * the loaded players per new bait, then memoized until the bait changes.
 */
export function clatterBaitHex(key: number): string | null {
  if (!key || !source) return null;
  if (key === baitKey && baitHex) return baitHex;
  baitKey = key; baitHex = null;
  for (const hex of source.hexes()) if (identityKey32(hex) === key) { baitHex = hex; break; }
  return baitHex;
}

/** A source over a SpacetimeDB connection's player table (identity index for single lookups). */
export function connectionPlayerSource(getConnection: () => any): ClatterPlayerSource {
  return {
    weaponOf(hex) {
      const players = getConnection()?.db?.player;
      if (!players?.identity) return null;
      try {
        const row = players.identity.find(Identity.fromString(hex));
        return row ? String(row.weapon ?? '') : null;
      } catch {
        return null;
      }
    },
    *hexes() {
      const players = getConnection()?.db?.player;
      if (!players?.iter) return;
      for (const row of players.iter()) yield row.identity.toHexString();
    },
  };
}
