import { describe, expect, it } from 'vitest';
import { SPIRE_EXIT, SpireStage } from '@sim';
import { inSpire, isOpenGround, isPlayerVisible, spireActiveRuns, spireLobbies } from '../bosses/selectors';

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
