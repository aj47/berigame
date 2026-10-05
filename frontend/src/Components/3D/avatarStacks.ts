import { useRef } from 'react';
import type { Player } from '../../module_bindings/types';
import { identityHex } from '../../spacetime/identity';

/** Ticks a player must stand still before it can fold into a stack (its walk animation trails the server tile). */
export const STACK_SETTLE_TICKS = 2;

export type StackInput = { hex: string; x: number; z: number; region: string; active: boolean; settled: boolean };

/**
 * Players standing on the same tile draw exactly on top of each other, so only
 * one of them needs a full avatar. Active players (walking, fighting, your
 * target) and players still arriving always draw. Of the settled players on a
 * tile the lowest identity draws, which stays stable as others come and go.
 * Returns the identities to draw, each with the hidden identities folded into it.
 */
export function stackAvatars(players: readonly StackInput[]): Map<string, string[]> {
  const shown = new Map<string, string[]>();
  const tiles = new Map<string, StackInput[]>();
  for (const p of players) {
    if (p.active || !p.settled) { shown.set(p.hex, []); continue; }
    const key = `${p.region}:${p.x},${p.z}`;
    const tile = tiles.get(key);
    if (tile) tile.push(p); else tiles.set(key, [p]);
  }
  for (const group of tiles.values()) {
    group.sort((a, b) => (a.hex < b.hex ? -1 : a.hex > b.hex ? 1 : 0));
    shown.set(group[0].hex, group.slice(1).map(p => p.hex));
  }
  return shown;
}

/**
 * Other players' avatars to draw (see stackAvatars). `tick` is the world tick;
 * pass the current one on every render so arrivals settle.
 */
export function useStackedAvatars(players: readonly Player[], me: string | null | undefined, target: string | null, tick: number): Map<string, string[]> {
  // Where each player last stopped, and the tick it stopped there.
  const stops = useRef(new Map<string, { at: string; since: number }>());
  const seen = new Set<string>();
  const inputs: StackInput[] = [];
  for (const p of players) {
    const hex = identityHex(p.identity);
    if (hex === me) continue;
    seen.add(hex);
    const region = p.region || 'bramblewild';
    const active = p.targetX !== undefined || p.combatTarget !== undefined || hex === target;
    let settled = false;
    if (!active) {
      const at = `${region}:${p.x},${p.z}`;
      const stop = stops.current.get(hex);
      // First sight (page load, a player joining in place) counts as settled: only an arrival waits.
      if (!stop) stops.current.set(hex, { at, since: tick - STACK_SETTLE_TICKS });
      else if (stop.at !== at) stops.current.set(hex, { at, since: tick });
      settled = tick - stops.current.get(hex)!.since >= STACK_SETTLE_TICKS;
    } else stops.current.set(hex, { at: '', since: tick });
    inputs.push({ hex, x: p.x, z: p.z, region, active, settled });
  }
  for (const hex of stops.current.keys()) if (!seen.has(hex)) stops.current.delete(hex);
  return stackAvatars(inputs);
}
