/**
 * Social and practice features: the training dummy in the Grove and emotes.
 * Pure data and rules shared by the SpacetimeDB module and the client.
 */
import { SPAWN_TILE } from './constants';
import { blockedSetFromTiles, chebyshev, tileKey } from './grid';
import type { Tile } from './types';

// ---- Training dummy ---------------------------------------------------------
export const DUMMY_ID = 1;
/**
 * The one practice post: 3 tiles south-east of spawn, diagonal to the safe
 * ring's corner (ring 3), off the four worn paths (x = 25, z = 25) and clear
 * of every tree's harvest tiles. It blocks its tile like a tree.
 */
export const DUMMY_TILE: Tile = { x: SPAWN_TILE.x + 3, z: SPAWN_TILE.z + 3 };
/** Damage it soaks before it springs back to full; it never dies. */
export const DUMMY_MAX_HP = 60;
/** Left alone this long, the dummy is back to full (computed lazily: no tick writes while idle). */
export const DUMMY_IDLE_RESET_TICKS = 25;

/** Every static blocker the client and server path around: the trees and nodes plus the dummy. */
export function worldBlockedSet(nodes: Iterable<Tile>): Set<number> {
  const s = blockedSetFromTiles(nodes);
  s.add(tileKey(DUMMY_TILE));
  return s;
}

export interface DummyHpState { hp: number; maxHp: number; lastHitTick: number }

/** HP the dummy shows at `tick`: full again after DUMMY_IDLE_RESET_TICKS without a hit. */
export function dummyHpAt(row: DummyHpState, tick: number): number {
  return tick - row.lastHitTick >= DUMMY_IDLE_RESET_TICKS ? row.maxHp : row.hp;
}

/** One swing on the dummy. A blow that would floor it resets it to full instead (`reset`). */
export function dummyAfterHit(row: DummyHpState, damage: number, tick: number): { hp: number; reset: boolean } {
  const hp = dummyHpAt(row, tick) - damage;
  return hp <= 0 ? { hp: row.maxHp, reset: true } : { hp, reset: false };
}

export function nearDummy(t: Tile, range = 1): boolean {
  return chebyshev(t, DUMMY_TILE) <= range;
}

// ---- Emotes -----------------------------------------------------------------
export const Emote = { Wave: 0, Cheer: 1, Sit: 2, Point: 3 } as const;
export type EmoteId = (typeof Emote)[keyof typeof Emote];

export interface EmoteDef { id: EmoteId; key: string; name: string; clip: string; durationMs: number }
/** Cosmetic only. `durationMs` is how long the pose shows; Sit holds until you move or act. */
export const EMOTES: Record<EmoteId, EmoteDef> = {
  [Emote.Wave]: { id: Emote.Wave, key: 'wave', name: 'Wave', clip: 'Wave', durationMs: 1900 },
  [Emote.Cheer]: { id: Emote.Cheer, key: 'cheer', name: 'Cheer', clip: 'Cheer', durationMs: 1550 },
  [Emote.Sit]: { id: Emote.Sit, key: 'sit', name: 'Sit', clip: 'Sit', durationMs: 60000 },
  [Emote.Point]: { id: Emote.Point, key: 'point', name: 'Point', clip: 'Point', durationMs: 1400 },
};
export const EMOTE_LIST: readonly EmoteDef[] = Object.values(EMOTES);
/** Ticks between two accepted emotes of one player (1.2 s). */
export const EMOTE_COOLDOWN_TICKS = 2;

export function isEmote(n: number): n is EmoteId {
  return Number.isInteger(n) && Object.prototype.hasOwnProperty.call(EMOTES, n);
}

export function emoteByKey(key: string): EmoteDef | undefined {
  const k = key.trim().toLowerCase();
  return EMOTE_LIST.find((e) => e.key === k);
}

/** Whether an emote may start: the cooldown since the last accepted one has passed. */
export function emoteReady(lastEmoteTick: number | undefined, tick: number): boolean {
  return lastEmoteTick === undefined || tick - lastEmoteTick >= EMOTE_COOLDOWN_TICKS;
}
