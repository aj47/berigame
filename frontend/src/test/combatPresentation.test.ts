import { describe, it, expect, afterEach, vi } from 'vitest';
import { Identity } from 'spacetimedb';
import { EventKind, Stance } from '@sim';
import { cuePose, exchangePresentation } from '../animation/combatPresentation';
import { useCombatFxStore } from '../spacetime/stores/combatFxStore';

const wins = [
  [Stance.Strike, Stance.Grab, 'Strike', 'Grab', 'Hit', 160],
  [Stance.Grab, Stance.Guard, 'Grab', 'Block', 'Grabbed', 224],
  [Stance.Guard, Stance.Strike, 'BlockCounter', 'Strike', 'Stagger', 288],
] as const;
afterEach(()=>vi.useRealTimers());
describe('paired authoritative combat presentation', () => {
  it.each(wins)('winner %s against %s tells the same story from either scheduled attacker', (winner, loser, action, attempted, reaction, impact) => {
    const hit = exchangePresentation(EventKind.Hit, winner, loser)!;
    const counter = exchangePresentation(EventKind.Counter, loser, winner)!;
    expect(counter.attacker).toEqual(hit.defender);
    expect(counter.defender).toEqual(hit.attacker);
    expect(hit.attacker.clip).toBe(action);
    expect(hit.defender.clip).toBe(attempted);
    expect(hit.defender.reaction).toEqual({clip:reaction,atMs:impact});
    expect(hit.impactMs).toBe(impact);
    const cue = {...hit.defender,seq:1,at:1000};
    expect(cuePose(cue,1000+impact-1)?.clip).toBe(attempted);
    expect(cuePose(cue,1000+impact)?.clip).toBe(reaction);
    expect(cuePose(cue,1000+impact)?.elapsedSeconds).toBe(0);
    expect(cuePose(cue,1000+cue.durationMs)).toBeNull();
  });
  it.each([0,1,2])('same-stance %s clashes involve both actors without a damaging recoil', stance => {
    const p=exchangePresentation(EventKind.Clash,stance,stance)!;
    expect(p.attacker).toEqual(p.defender);
    expect(p.attacker.reaction).toBeUndefined();
    expect(p.attacker.clip).not.toBe('BlockCounter');
  });
  it('a counter preserves the losing attack before recoil, animates the winner, and uses committed event stances', () => {
    vi.useFakeTimers();
    const attacker=new Identity(11n),defender=new Identity(12n);
    useCombatFxStore.setState({seq:0,numbers:{},attackSeq:{},cues:{}});
    useCombatFxStore.getState().pushEvent({attacker,defender,kind:EventKind.Counter,damage:2,attackerStance:Stance.Strike,defenderStance:Stance.Guard} as any);
    const s=useCombatFxStore.getState(),a=attacker.toHexString(),d=defender.toHexString();
    expect(s.cues[a].clip).toBe('Strike');
    expect(s.cues[a].reaction?.clip).toBe('Stagger');
    expect(s.cues[d].clip).toBe('BlockCounter');
    expect(s.numbers[a].delayMs).toBe(288);
    // Healing does not overwrite the ongoing exchange animation.
    useCombatFxStore.getState().pushEvent({attacker,defender:attacker,kind:EventKind.Eat,damage:3} as any);
    expect(useCombatFxStore.getState().cues[a]).toEqual(s.cues[a]);
    vi.runAllTimers();
    expect(useCombatFxStore.getState().cues).toEqual({});
    expect(useCombatFxStore.getState().numbers).toEqual({});
  });
});
