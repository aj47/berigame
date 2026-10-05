import type { Intersection } from 'three';
import type { Tile } from '@sim';
import { hoverTargetOf } from './hoverTarget';

type PlayerHit = Pick<Intersection, 'object' | 'point'>;
type PlayerChoice = { hex: string; name: string; tile?: Tile };

/** All selectable players along the pointer ray, including those hidden behind another avatar. */
export function playersInHits(hits: readonly PlayerHit[]) {
  const players = new Map<string, PlayerChoice>();
  for (const hit of hits) {
    const hint = hoverTargetOf(hit.object, hit.point)?.hint;
    if (hint?.playerHex && !players.has(hint.playerHex)) {
      players.set(hint.playerHex, { hex: hint.playerHex, name: hint.title,
        ...(hint.tile ? { tile: { x: hint.tile.x, z: hint.tile.z } } : {}),
      });
    }
  }
  return [...players.values()];
}

/**
 * Keep loot at the avatars' feet separate from the ray's Walk here destination.
 * `stacked` players stand on the avatar's tile without an avatar of their own (avatarStacks).
 */
export function avatarSelection(avatar: Tile & { hex: string; name: string; isSelf: boolean }, hits: readonly PlayerHit[], stacked: readonly string[] = []) {
  const candidates = playersInHits(hits);
  if (!avatar.isSelf && !candidates.some(player => player.hex === avatar.hex)) {
    candidates.unshift({ hex: avatar.hex, name: avatar.name, tile: { x: avatar.x, z: avatar.z } });
  }
  const at = candidates.findIndex(player => player.hex === avatar.hex);
  const hidden = stacked.filter(hex => !candidates.some(player => player.hex === hex))
    .map(hex => ({ hex, name: '', tile: { x: avatar.x, z: avatar.z } }));
  candidates.splice(at < 0 ? candidates.length : at + 1, 0, ...hidden);
  const tiles = new Map<string, Tile>();
  for (const tile of [avatar, ...candidates.flatMap(player => player.tile ? [player.tile] : [])]) {
    tiles.set(`${tile.x},${tile.z}`, { x: tile.x, z: tile.z });
  }
  return {
    connectionId: candidates.length > 1 ? 'Choose player' : candidates[0]?.name ?? 'You',
    groundTiles: [...tiles.values()],
    ...(candidates.length ? {
      playerChoices: candidates.map(player => player.hex),
      playerHex: candidates.length === 1 ? candidates[0].hex : undefined,
    } : { dropdownOptions: [] }),
  };
}
