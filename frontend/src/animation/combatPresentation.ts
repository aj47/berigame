import { EventKind, Stance } from '@sim';

export type Clip = 'Idle'|'Walk'|'Run'|'RunGrab'|'RunGuard'|'Strike'|'Grab'|'GrabReady'|'Guard'|'Block'|'BlockCounter'|'Grabbed'|'Hit'|'Stagger'|'Defeat';
export interface ExchangeCue {
  clip: Clip;
  durationMs: number;
  reaction?: { clip: Clip; atMs: number };
}
export interface AnimationCue extends ExchangeCue { seq: number; at: number }
export interface ExchangePresentation { attacker: ExchangeCue; defender: ExchangeCue; impactMs: number }

/** Both sides tell the same physical story, even when the defender wins the RPS. */
export function exchangePresentation(kind: number, attackerStance: number, defenderStance: number): ExchangePresentation | null {
  if (kind === EventKind.Clash) {
    const clip: Clip = attackerStance === Stance.Guard ? 'Block' : attackerStance === Stance.Grab ? 'GrabReady' : 'Strike';
    return { attacker: { clip, durationMs: 500 }, defender: { clip, durationMs: 500 }, impactMs: 160 };
  }
  if (kind !== EventKind.Hit && kind !== EventKind.Counter) return null;
  const attackerWins = kind === EventKind.Hit;
  const winnerStance = attackerWins ? attackerStance : defenderStance;
  let winner: ExchangeCue, loser: ExchangeCue, impactMs: number;
  if (winnerStance === Stance.Grab) {
    impactMs = 224;
    winner = { clip: 'Grab', durationMs: 700 };
    loser = { clip: 'Block', reaction: { clip: 'Grabbed', atMs: impactMs }, durationMs: 724 };
  } else if (winnerStance === Stance.Guard) {
    impactMs = 288;
    winner = { clip: 'BlockCounter', durationMs: 600 };
    loser = { clip: 'Strike', reaction: { clip: 'Stagger', atMs: impactMs }, durationMs: 788 };
  } else {
    impactMs = 160;
    winner = { clip: 'Strike', durationMs: 500 };
    loser = { clip: 'Grab', reaction: { clip: 'Hit', atMs: impactMs }, durationMs: 560 };
  }
  return attackerWins ? { attacker: winner, defender: loser, impactMs } : { attacker: loser, defender: winner, impactMs };
}

export function cuePose(cue: AnimationCue | null, now: number): { clip: Clip; key: string; elapsedSeconds: number } | null {
  if (!cue || now < cue.at || now >= cue.at + cue.durationMs) return null;
  const elapsed = now - cue.at;
  const reacting = cue.reaction && elapsed >= cue.reaction.atMs;
  return { clip: reacting ? cue.reaction!.clip : cue.clip, key: `${cue.seq}:${reacting ? 'reaction' : 'action'}`, elapsedSeconds: (elapsed - (reacting ? cue.reaction!.atMs : 0)) / 1000 };
}
