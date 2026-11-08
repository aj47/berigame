import { describe, expect, it } from 'vitest';
import { LANTERN_EXIT, LANTERN_SPAWNS, SPIRE_EXIT, SpireStage, lanternTile } from '@sim';
import {
  inLantern, inSpire, isOpenGround, isPlayerVisible, lanternActiveRuns, lanternLobbies, myFloor, sealedFloorOf, spireActiveRuns, spireLobbies,
} from '../bosses/selectors';

const p = (hex: string, x: number, z: number, region?: string) => ({ identity: { toHexString: () => hex }, x, z, region });

describe('isPlayerVisible (the shared spireSeesPlayer rule)', () => {
  const outside = p('me', 61, 45), insideMe = p('me', 72, 68);
  const mate = p('mate', 75, 68), stranger = p('other', 79, 68), walker = p('walker', 60, 45);

  it('hides every floor player from an overworld viewer', () => {
    expect(isPlayerVisible(walker, outside, new Set())).toBe(true);
    expect(isPlayerVisible(mate, outside, new Set())).toBe(false);
    // Even your own run-mates while you wait at the exit.
    expect(isPlayerVisible(mate, outside, new Set(['me', 'mate']))).toBe(false);
  });

  it('shows only your own run inside, never the overworld', () => {
    const run = new Set(['me', 'mate']);
    expect(isPlayerVisible(mate, insideMe, run)).toBe(true);
    expect(isPlayerVisible(stranger, insideMe, run)).toBe(false);
    expect(isPlayerVisible(walker, insideMe, run)).toBe(false);
  });

  it('always shows yourself, even stranded on the floor without a run', () => {
    expect(isPlayerVisible(insideMe, insideMe, new Set())).toBe(true);
    expect(isPlayerVisible(stranger, insideMe, new Set())).toBe(false);
  });

  it('treats a missing viewer as the overworld and ignores other regions', () => {
    expect(isPlayerVisible(mate, null, new Set())).toBe(false);
    expect(isPlayerVisible(walker, undefined, new Set())).toBe(true);
    expect(isPlayerVisible(p('town', 72, 68, 'settlement'), outside, new Set())).toBe(true);
  });
});

describe('ground and runs', () => {
  it('reads the floor as water from outside and the overworld as unreachable from inside', () => {
    expect(isOpenGround(SPIRE_EXIT, false)).toBe(true);
    expect(isOpenGround({ x: 72, z: 68 }, false)).toBe(false);
    expect(isOpenGround({ x: 72, z: 68 }, true)).toBe(true);
    expect(isOpenGround(SPIRE_EXIT, true)).toBe(false);
    expect(isOpenGround({ x: 66, z: 62 }, false)).toBe(false);
  });

  it('knows when you stand inside', () => {
    expect(inSpire(p('me', 72, 68))).toBe(true);
    expect(inSpire(p('me', 72, 68, 'settlement'))).toBe(false);
    expect(inSpire(p('me', 61, 45))).toBe(false);
    expect(inSpire(null)).toBe(false);
  });

  it('lists lobbies oldest first and counts active runs', () => {
    const runs = new Map<string, any>([
      ['3', { id: 3n, stage: SpireStage.Lobby, createdTick: 30 }],
      ['1', { id: 1n, stage: SpireStage.Active, createdTick: 5 }],
      ['2', { id: 2n, stage: SpireStage.Lobby, createdTick: 20 }],
    ]);
    expect(spireLobbies({ runs }).map((r) => r.id)).toEqual([2n, 3n]);
    expect(spireActiveRuns({ runs })).toBe(1);
  });
});

describe('Lanternmaw: the same rule on the Drowned Hollow floor', () => {
  const a = lanternTile(LANTERN_SPAWNS[0]), b = lanternTile(LANTERN_SPAWNS[1]);
  const insideMe = p('me', a.x, a.z), mate = p('mate', b.x, b.z), stranger = p('other', b.x + 2, b.z);
  const outside = p('me', LANTERN_EXIT.x, LANTERN_EXIT.z), walker = p('walker', LANTERN_EXIT.x + 1, LANTERN_EXIT.z);
  const spireMate = p('spiremate', 72, 68);

  it('treats lantern run mates as the same run inside and hides everyone else', () => {
    const lantern = new Set(['me', 'mate']);
    expect(isPlayerVisible(mate, insideMe, new Set(), lantern)).toBe(true);
    expect(isPlayerVisible(stranger, insideMe, new Set(), lantern)).toBe(false);
    expect(isPlayerVisible(walker, insideMe, new Set(), lantern)).toBe(false);
    // Without the lantern set a mate is a stranger; a Spire run set does not count on this floor.
    expect(isPlayerVisible(mate, insideMe, new Set(['me', 'mate']))).toBe(false);
  });

  it('never shows one floor to the other or to the overworld', () => {
    const both = new Set(['me', 'mate', 'spiremate']);
    expect(isPlayerVisible(spireMate, insideMe, both, both)).toBe(false);
    expect(isPlayerVisible(mate, p('me', 72, 68), both, both)).toBe(false);
    expect(isPlayerVisible(mate, outside, both, both)).toBe(false);
    expect(isPlayerVisible(walker, outside, new Set(), new Set())).toBe(true);
  });

  it('knows which floor a tile is on and keeps walks on your side', () => {
    expect(sealedFloorOf(a)).toBe('lantern');
    expect(sealedFloorOf({ x: 72, z: 68 })).toBe('spire');
    expect(sealedFloorOf(LANTERN_EXIT)).toBeNull();
    expect(myFloor(insideMe)).toBe('lantern');
    expect(inLantern(insideMe)).toBe(true);
    expect(inLantern(outside)).toBe(false);
    expect(inSpire(insideMe)).toBe(false);
    expect(isOpenGround(a, 'lantern')).toBe(true);
    expect(isOpenGround(a, null)).toBe(false);
    expect(isOpenGround(a, true)).toBe(false);
    expect(isOpenGround(LANTERN_EXIT, 'lantern')).toBe(false);
    expect(isOpenGround(LANTERN_EXIT, false)).toBe(true);
  });

  it('lists lantern lobbies and counts active lantern runs', () => {
    const lanternRuns = new Map<string, any>([
      ['5', { id: 5n, stage: SpireStage.Lobby, createdTick: 40 }],
      ['4', { id: 4n, stage: SpireStage.Lobby, createdTick: 10 }],
      ['6', { id: 6n, stage: SpireStage.Active, createdTick: 1 }],
    ]);
    expect(lanternLobbies({ lanternRuns }).map((r) => r.id)).toEqual([4n, 5n]);
    expect(lanternActiveRuns({ lanternRuns })).toBe(1);
  });
});
