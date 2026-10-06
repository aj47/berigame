import { beforeEach, describe, expect, it } from 'vitest';
import { Pending, SpireMemberState, SpireStage } from '@sim';
import { BOSS_EVENT_RING, BOSS_NOTICE_RING, swingCueTick, useBossStore } from '../bosses/bossStore';
import { onWorldTick, tickClock } from '../spacetime/tickClock';

const id = (hex: string) => ({ toHexString: () => hex });
const run = (n: bigint, extra: object = {}) => ({ id: n, leader: id('aa'), stage: SpireStage.Lobby, outcome: 0, mode: 0, isPublic: true, rules: 1, partySize: 1,
  createdTick: 10, queuedTick: 0, startTick: 0, endTick: 160, phase: 0, clearTicks: 0, ...extra }) as any;
const member = (hex: string, runId: bigint, slot = 0) => ({ identity: id(hex), runId, slot, state: SpireMemberState.Lobby, joinedTick: 10,
  awaySinceTick: 0, awayCount: 0, downUntilTick: 0, reviveSinceTick: 0, meals: 0 }) as any;
const fight = (runId: bigint, hp = 1000) => ({ runId, hp, maxHp: hp, phase: 1 }) as any;
const store = () => useBossStore.getState();

describe('bossStore rows and derived membership', () => {
  beforeEach(() => store().reset());

  it('starts empty, so components without a provider render as before', () => {
    expect(store()).toMatchObject({ config: null, clatter: null, fight: null, myMember: null, myRun: null, lobbyOpen: false });
    expect(store().runs.size).toBe(0);
    expect(store().myRunHexes.size).toBe(0);
  });

  it('keeps singleton rows and deletes them by key', () => {
    store().setRow('bossConfig', { id: 0, clatterhornOpen: true } as any);
    store().setRow('clatterhorn', { id: 1, hp: 200 } as any);
    expect(store().config?.clatterhornOpen).toBe(true);
    expect(store().clatter?.hp).toBe(200);
    store().deleteRow('clatterhorn', 2);
    expect(store().clatter).not.toBeNull();
    store().deleteRow('clatterhorn', 1);
    store().deleteRow('bossConfig', 0);
    expect(store().clatter).toBeNull();
    expect(store().config).toBeNull();
  });

  it('derives your member row, run, run-mates and fight, and follows changes in any order', () => {
    store().setRow('spireMember', member('aa', 41n));
    store().setRow('spireRun', run(41n));
    store().setRow('spireFight', fight(41n));
    expect(store().myMember).toBeNull();
    store().setMe('aa');
    expect(store().myMember?.runId).toBe(41n);
    expect(store().myRun?.id).toBe(41n);
    expect(store().fight?.hp).toBe(1000);
    store().setRow('spireMember', member('bb', 41n, 1));
    store().setRow('spireMember', member('cc', 42n));
    expect([...store().myRunHexes].sort()).toEqual(['aa', 'bb']);
    store().setRow('spireRun', run(41n, { stage: SpireStage.Active }));
    expect(store().myRun?.stage).toBe(SpireStage.Active);
    store().setRow('spireFight', fight(41n, 700));
    expect(store().fight?.hp).toBe(700);
    // Moving to another run swaps run, fight and run-mates.
    store().setRow('spireMember', member('aa', 42n));
    expect(store().myRun).toBeNull();
    expect(store().fight).toBeNull();
    expect([...store().myRunHexes].sort()).toEqual(['aa', 'cc']);
    store().deleteRow('spireMember', 'aa');
    expect(store().myMember).toBeNull();
    expect(store().myRunHexes.size).toBe(0);
    store().deleteRow('spireRun', 41n);
    store().deleteRow('spireFight', 41n);
    expect(store().runs.size).toBe(0);
    expect(store().fights.size).toBe(0);
  });

  it('keeps the last notices and events in rings', () => {
    for (let i = 0; i < BOSS_NOTICE_RING + 5; i++) store().pushNotice({ tick: i } as any);
    for (let i = 0; i < BOSS_EVENT_RING + 5; i++) store().pushEvent({ tick: i } as any);
    expect(store().notices).toHaveLength(BOSS_NOTICE_RING);
    expect(store().notices[0].row.tick).toBe(5);
    expect(store().events).toHaveLength(BOSS_EVENT_RING);
    expect(store().events.at(-1)!.row.tick).toBe(BOSS_EVENT_RING + 4);
    const seqs = [...store().notices, ...store().events].map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('opens and closes the lobby panel', () => {
    store().setLobbyOpen(true);
    expect(store().lobbyOpen).toBe(true);
    store().setLobbyOpen(false);
    expect(store().lobbyOpen).toBe(false);
  });
});

describe('Clatterhorn swing cues from player rows', () => {
  beforeEach(() => store().reset());
  const row = (pending: number, nextSwingTick: number, eatCooldownUntilTick = 0) => ({ identity: id('dd'), pending, nextSwingTick, eatCooldownUntilTick });

  it('a pending-6 row whose nextSwingTick jumps by 4 pushes one cue, whichever update arrives first', () => {
    const T = 500;
    // world before player
    onWorldTick(T);
    store().onPlayerUpdate(row(Pending.Clatterhorn, T - 1), row(Pending.Clatterhorn, T + 4));
    // player before world (the next landed swing, 4 ticks later)
    store().onPlayerUpdate(row(Pending.Clatterhorn, T + 4), row(Pending.Clatterhorn, T + 8));
    onWorldTick(T + 4);
    expect(store().swingCues.map((c) => [c.hex, c.tick])).toEqual([['dd', T], ['dd', T + 4]]);
    expect(tickClock.tick).toBe(T + 4);
  });

  it('pushes nothing for attack_clatterhorn, an unchanged re-select or a meal', () => {
    store().onPlayerUpdate(row(Pending.None, 10), row(Pending.Clatterhorn, 31));
    store().onPlayerUpdate(row(Pending.Clatterhorn, 31), row(Pending.Clatterhorn, 31));
    store().onPlayerUpdate(row(Pending.Clatterhorn, 31, 20), row(Pending.Clatterhorn, 35, 33));
    store().onPlayerUpdate(row(Pending.Giant, 31), row(Pending.Giant, 35));
    expect(store().swingCues).toEqual([]);
    expect(swingCueTick(row(Pending.Clatterhorn, 31), row(Pending.Clatterhorn, 34))).toBeNull();
    expect(swingCueTick(row(Pending.Clatterhorn, 30), row(Pending.Clatterhorn, 34))).toBe(30);
  });
});
