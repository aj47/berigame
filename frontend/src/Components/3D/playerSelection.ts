import type { Intersection } from 'three';
import { hoverTargetOf } from './hoverTarget';

/** All selectable players along the pointer ray, including those hidden behind another avatar. */
export function playersInHits(hits: readonly Pick<Intersection, 'object' | 'point'>[]) {
  const players = new Map<string, { hex: string; name: string }>();
  for (const hit of hits) {
    const hint = hoverTargetOf(hit.object, hit.point)?.hint;
    if (hint?.playerHex && !players.has(hint.playerHex)) {
      players.set(hint.playerHex, { hex: hint.playerHex, name: hint.title });
    }
  }
  return [...players.values()];
}
