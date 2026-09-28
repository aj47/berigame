import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Identity } from 'spacetimedb';
import { EventKind, STICK_ITEM_ID } from '@sim';
import { CLIPS, PUNCH_ATTACK, STICK_ATTACK, attackPresentation, cuePose, type AnimationCue } from '../animation/combatPresentation';
import { STICK_SWING_CLIP, STICK_SWING_IMPACT_MS, STICK_SWING_MS } from '../animation/stickSwing';
import { useCombatFxStore } from '../spacetime/stores/combatFxStore';

const attacker = new Identity(11n), defender = new Identity(12n);
const a = attacker.toHexString(), d = defender.toHexString();
const event = (kind: number, extra: Record<string, unknown> = {}) =>
  ({ tick: 1, kind, attacker, defender, damage: 0, itemId: '', defenderHp: 20, ...extra }) as any;
const push = (e: unknown) => useCombatFxStore.getState().pushEvent(e as any);

let now = 1000;
beforeEach(() => {
  now = 1000;
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  useCombatFxStore.setState({ seq: 0, numbers: {}, finds: {}, cues: {} });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('attack presentation', () => {
  it('punches with the baked Strike jab, landing 160ms in', () => {
    expect(attackPresentation(EventKind.Hit, '')).toEqual({ attacker: { clip: 'Strike', durationMs: 500 }, defender: { clip: 'Hit', durationMs: 400 }, impactMs: 160 });
  });

  it('swings a wielded stick with its own chop, landing later', () => {
    const stick = attackPresentation(EventKind.Hit, STICK_ITEM_ID)!;
    expect(stick.attacker).toEqual({ clip: STICK_SWING_CLIP, durationMs: STICK_SWING_MS });
    expect(stick.defender).toEqual({ clip: 'HitHeavy', durationMs: 550 });
    expect(stick.impactMs).toBe(STICK_SWING_IMPACT_MS);
    expect(stick.impactMs).toBeGreaterThan(PUNCH_ATTACK.impactMs);
    expect(stick.impactMs).toBeLessThan(stick.attacker.durationMs);
  });

  it('only swings animate', () => {
    for (const kind of [EventKind.Death, EventKind.Eat, EventKind.HarvestDone, EventKind.ItemFound, 1, 2, 3]) expect(attackPresentation(kind, STICK_ITEM_ID)).toBeNull();
  });

  it('only uses clips the avatar knows', () => {
    for (const attack of [PUNCH_ATTACK, STICK_ATTACK]) expect(CLIPS).toContain(attack.clip);
    expect(CLIPS).toContain('Hit');
  });

  it('plays a cue only inside its window, keyed by role', () => {
    const cue: AnimationCue = { clip: 'Hit', durationMs: 400, seq: 7, at: 1300, role: 'reaction' };
    expect(cuePose(cue, 1299)).toBeNull();
    expect(cuePose(cue, 1300)).toEqual({ clip: 'Hit', key: '7:reaction', elapsedSeconds: 0 });
    expect(cuePose(cue, 1500)?.elapsedSeconds).toBeCloseTo(0.2);
    expect(cuePose(cue, 1700)).toBeNull();
    expect(cuePose(null, 1500)).toBeNull();
  });
});

describe('combat fx store', () => {
  it('animates a punch: Strike now, the defender flinches and the damage floats at 160ms', () => {
    push(event(EventKind.Hit, { damage: 3 }));
    const s = useCombatFxStore.getState();
    expect(s.cues[a]).toEqual({ clip: 'Strike', durationMs: 500, role: 'action', at: 1000, seq: 1 });
    expect(s.cues[d]).toEqual({ clip: 'Hit', durationMs: 400, role: 'reaction', at: 1160, seq: 1, attacker: a });
    expect(s.numbers[d]).toMatchObject({ text: '3', kind: EventKind.Hit, itemId: '', at: 1000, delayMs: 160 });
    expect(cuePose(s.cues[d], 1100)).toBeNull(); // Not hit yet.
    expect(cuePose(s.cues[d], 1160)?.key).toBe('1:reaction');
    expect(cuePose(s.cues[a], 1000)?.key).toBe('1:action');
  });

  it("animates the stick from the event's itemId, and delays the reaction and damage to the stick's impact", () => {
    push(event(EventKind.Hit, { damage: 6, itemId: STICK_ITEM_ID }));
    const s = useCombatFxStore.getState();
    expect(s.cues[a]).toMatchObject({ clip: STICK_SWING_CLIP, durationMs: STICK_SWING_MS, role: 'action', at: 1000 });
    expect(s.cues[d]).toMatchObject({ clip: 'HitHeavy', role: 'reaction', at: 1000 + STICK_SWING_IMPACT_MS });
    expect(s.numbers[d]).toMatchObject({ text: '6', itemId: STICK_ITEM_ID, delayMs: STICK_SWING_IMPACT_MS });
    expect(s.numbers[a]).toBeUndefined();
  });

  it('does not let eating overwrite a swing in progress', () => {
    push(event(EventKind.Hit, { damage: 6, itemId: STICK_ITEM_ID }));
    const swing = useCombatFxStore.getState().cues[a];
    now = 1100;
    push(event(EventKind.Eat, { defender: attacker, damage: 5 }));
    const s = useCombatFxStore.getState();
    expect(s.cues[a]).toEqual(swing);
    expect(s.numbers[a]).toMatchObject({ text: '+5', kind: EventKind.Eat, delayMs: 0 });
  });

  it("does not cut a defender's own swing short with a flinch", () => {
    push(event(EventKind.Hit, { damage: 6, itemId: STICK_ITEM_ID }));
    const swing = useCombatFxStore.getState().cues[a];
    // The defender punches back while the stick chop is still playing.
    now = 1200;
    push(event(EventKind.Hit, { attacker: defender, defender: attacker, damage: 3 }));
    const s = useCombatFxStore.getState();
    expect(s.cues[a]).toEqual(swing);
    expect(s.cues[d]).toMatchObject({ clip: 'Strike', role: 'action', at: 1200 });
    // Once the chop is over, the next blow gets its flinch.
    now = 3000;
    push(event(EventKind.Hit, { attacker: defender, defender: attacker, damage: 3 }));
    expect(useCombatFxStore.getState().cues[a]).toMatchObject({ clip: 'Hit', role: 'reaction', at: 3160 });
  });

  it("lets a defender's swing that ends before impact finish, then flinch", () => {
    push(event(EventKind.Hit, { damage: 6, itemId: STICK_ITEM_ID })); // chop 1000..1620
    // The punch back arrives at 1500 and lands at 1660, after the chop is over.
    now = 1500;
    push(event(EventKind.Hit, { attacker: defender, defender: attacker, damage: 3 }));
    const cue = useCombatFxStore.getState().cues[a];
    expect(cuePose(cue, 1600)).toMatchObject({ clip: STICK_SWING_CLIP, key: '1:action' });
    expect(cuePose(cue, 1640)).toBeNull();
    expect(cuePose(cue, 1660)).toMatchObject({ clip: 'Hit', key: '2:reaction', elapsedSeconds: 0 });
    expect(cuePose(cue, 2060)).toBeNull();
    // The chained flinch outlives nothing: both cues are cleared by their timers.
    vi.runAllTimers();
    expect(useCombatFxStore.getState().cues).toEqual({});
  });

  it('clears cues and numbers once they have played', () => {
    push(event(EventKind.Hit, { damage: 6, itemId: STICK_ITEM_ID }));
    push(event(EventKind.HarvestDone, { attacker: defender, itemId: 'berry_blueberry' }));
    vi.runAllTimers();
    const s = useCombatFxStore.getState();
    expect(s.cues).toEqual({});
    expect(s.numbers).toEqual({});
  });
});
