import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventKind, STICK_ITEM_ID, STONE_CLUB_ITEM_ID } from '@sim';

const played: { name: string; delayMs?: number; x?: number }[] = [];
vi.mock('../audio', () => ({ audio: { play: (name: string, o: any = {}) => { played.push({ name, ...o }); return true; } } }));
vi.mock('../animation/avatarRegistry', () => ({ locateAvatar: (hex: string) => (hex === 'far' ? null : { x: hex === 'a' ? 1 : 2, z: 0 }) }));

import { DEATH_THUD_MS, fxQueue, onCombatEvent, weaponWeight } from '../fx/combatFx';
import { clearFlashes, flashStage } from '../fx/hitFlash';

describe('combat event effects', () => {
  beforeEach(() => { played.length = 0; clearFlashes(); fxQueue.drain(Infinity, () => {}); });

  it('a stick blow: whoosh before impact, a stick hit, flash and dust at impact', () => {
    onCombatEvent(EventKind.Hit, STICK_ITEM_ID, 'a', 'b', 1000, 520);
    const whoosh = played.find((p) => p.name === 'whoosh')!;
    const hit = played.find((p) => p.name === 'stick')!;
    expect(whoosh.delayMs).toBeLessThan(520);
    expect(whoosh.x).toBe(1);
    expect(hit).toMatchObject({ delayMs: 520, x: 2 });
    expect(flashStage('b', 1519)).toBe(0);
    expect(flashStage('b', 1520)).toBe(1);
    const fired: any[] = [];
    fxQueue.drain(1519, (e) => fired.push({ ...e }));
    expect(fired).toHaveLength(0);
    fxQueue.drain(1520, (e) => fired.push({ ...e }));
    expect(fired).toEqual([expect.objectContaining({ target: 'b', source: 'a', weight: 1 })]);
  });

  it('picks the hit sound by weapon and falls back to non-positional when unplaced', () => {
    onCombatEvent(EventKind.Hit, '', 'a', 'far', 0, 160);
    onCombatEvent(EventKind.Hit, STONE_CLUB_ITEM_ID, 'a', 'b', 0, 520);
    expect(played.filter((p) => p.name !== 'whoosh').map((p) => p.name)).toEqual(['punch', 'club']);
    expect(played.find((p) => p.name === 'punch')!.x).toBeUndefined();
    expect([weaponWeight(''), weaponWeight(STICK_ITEM_ID), weaponWeight(STONE_CLUB_ITEM_ID)]).toEqual([0, 1, 2]);
  });

  it('death, eat, harvest and find sounds', () => {
    onCombatEvent(EventKind.Death, '', 'a', 'b', 0, 0);
    onCombatEvent(EventKind.Eat, 'berry_strawberry', 'b', 'b', 0, 0);
    onCombatEvent(EventKind.HarvestDone, 'berry_strawberry', 'b', 'b', 0, 0);
    onCombatEvent(EventKind.ItemFound, STICK_ITEM_ID, 'b', 'b', 0, 0);
    expect(played.map((p) => p.name)).toEqual(['thud', 'eat', 'pop', 'chime']);
    expect(played[0].delayMs).toBe(DEATH_THUD_MS);
  });
});
