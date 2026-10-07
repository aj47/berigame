import { describe, expect, it } from 'vitest';
import { enterRule, inSafeRing, ringOf } from '../areas';
import { SAFE_RADIUS, SPAWN_TILE } from '../constants';
import { blockedSetFromTiles, chebyshev, neighbors8, tileKey } from '../grid';
import { TREE_SEEDS } from '../items';
import { NODE_SEEDS } from '../nodes';
import { reachableTiles } from '../pathfinding';
import {
  DUMMY_IDLE_RESET_TICKS, DUMMY_MAX_HP, DUMMY_TILE, EMOTES, EMOTE_LIST, Emote, dummyAfterHit, dummyHpAt, emoteByKey, emoteReady,
  isEmote, worldBlockedSet,
} from '../social';

describe('training dummy placement', () => {
  it('stands on the safe ring corner, in the Grove, off the worn paths', () => {
    expect(inSafeRing(DUMMY_TILE)).toBe(true);
    expect(ringOf(DUMMY_TILE)).toBe(SAFE_RADIUS);
    // The four worn paths run along x = 25 and z = 25.
    expect(DUMMY_TILE.x).not.toBe(SPAWN_TILE.x);
    expect(DUMMY_TILE.z).not.toBe(SPAWN_TILE.z);
  });

  it('keeps every tree and its harvest tiles clear, and a safe-ring tile can reach it', () => {
    for (const tree of [...TREE_SEEDS, ...NODE_SEEDS]) expect(chebyshev(tree, DUMMY_TILE)).toBeGreaterThan(2);
    const blocked = worldBlockedSet(TREE_SEEDS);
    expect(blocked.has(tileKey(DUMMY_TILE))).toBe(true);
    const reach = reachableTiles(SPAWN_TILE, blocked, enterRule(false));
    expect(reach.has(tileKey(DUMMY_TILE))).toBe(false);
    for(const tree of TREE_SEEDS)expect(neighbors8(tree).some(t=>reach.has(tileKey(t)))).toBe(true);
    expect(neighbors8(DUMMY_TILE).filter((t) => reach.has(tileKey(t)))).toHaveLength(8);
    expect(neighbors8(DUMMY_TILE).some(inSafeRing)).toBe(true);
  });
});

describe('training dummy HP', () => {
  const row = { hp: DUMMY_MAX_HP, maxHp: DUMMY_MAX_HP, lastHitTick: 0 };
  it('takes damage and springs back to full instead of dying', () => {
    expect(dummyAfterHit({ ...row, lastHitTick: 100 }, 6, 101)).toEqual({ hp: DUMMY_MAX_HP - 6, reset: false });
    expect(dummyAfterHit({ ...row, hp: 6, lastHitTick: 100 }, 6, 101)).toEqual({ hp: DUMMY_MAX_HP, reset: true });
    expect(dummyAfterHit({ ...row, hp: 3, lastHitTick: 100 }, 8, 101)).toEqual({ hp: DUMMY_MAX_HP, reset: true });
  });
  it('recovers lazily once left alone', () => {
    const hurt = { ...row, hp: 10, lastHitTick: 100 };
    expect(dummyHpAt(hurt, 100 + DUMMY_IDLE_RESET_TICKS - 1)).toBe(10);
    expect(dummyHpAt(hurt, 100 + DUMMY_IDLE_RESET_TICKS)).toBe(DUMMY_MAX_HP);
    expect(dummyAfterHit(hurt, 3, 100 + DUMMY_IDLE_RESET_TICKS).hp).toBe(DUMMY_MAX_HP - 3);
  });
});

describe('emotes', () => {
  it('have ids, keys and clips', () => {
    expect(EMOTE_LIST.map((e) => e.key)).toEqual(['wave', 'cheer', 'sit', 'point', 'dance', 'laugh', 'bow', 'shrug']);
    for (const e of EMOTE_LIST) { expect(isEmote(e.id)).toBe(true); expect(emoteByKey(` ${e.key.toUpperCase()} `)).toBe(EMOTES[e.id]); }
    expect(isEmote(8)).toBe(false);
    expect(isEmote(1.5)).toBe(false);
    expect(emoteByKey('dance')?.id).toBe(Emote.Dance);
    expect(EMOTES[Emote.Sit].durationMs).toBeGreaterThan(EMOTES[Emote.Wave].durationMs);
  });
  it('cool down for two ticks', () => {
    expect(emoteReady(undefined, 0)).toBe(true);
    expect(emoteReady(10, 11)).toBe(false);
    expect(emoteReady(10, 12)).toBe(true);
  });
});
