import { EventKind, STICK_ITEM_ID } from '@sim';
import { STICK_SWING_CLIP, STICK_SWING_IMPACT_MS, STICK_SWING_MS } from './stickSwing';

/** Every clip an adventurer plays: locomotion, the two attacks, the hit reaction and defeat. */
export const CLIPS = ['Idle', 'Run', 'Strike', STICK_SWING_CLIP, 'Hit', 'Defeat'] as const;
export type Clip = (typeof CLIPS)[number];

export interface ActionCue {
  clip: Clip;
  durationMs: number;
}
/**
 * A one-off clip scheduled on one avatar. `action` is the attacker's swing,
 * starting when the event arrives; `reaction` is the defender's Hit, starting
 * at the swing's impact.
 */
export interface AnimationCue extends ActionCue {
  seq: number;
  at: number;
  role: 'action' | 'reaction';
}
export interface AttackPresentation {
  attacker: ActionCue;
  defender: ActionCue;
  /** When the blow lands, from the start of the attacker's clip. */
  impactMs: number;
}

/** Bare fists: the baked 'Strike' jab lands 160ms in. */
export const PUNCH_ATTACK = { clip: 'Strike', durationMs: 500, impactMs: 160 } as const;
/** A wielded stick: the synthesized overhead chop (animation/stickSwing.ts). */
export const STICK_ATTACK = { clip: STICK_SWING_CLIP, durationMs: STICK_SWING_MS, impactMs: STICK_SWING_IMPACT_MS } as const;
const HIT_REACTION: ActionCue = { clip: 'Hit', durationMs: 400 };

/**
 * How one swing looks, from the committed event: `itemId` is what the
 * attacker held when the server resolved the swing ('' = punch). Never read
 * the live player row here; it may already have changed.
 */
export function attackPresentation(kind: number, itemId: string): AttackPresentation | null {
  if (kind !== EventKind.Hit) return null;
  const { clip, durationMs, impactMs } = itemId === STICK_ITEM_ID ? STICK_ATTACK : PUNCH_ATTACK;
  return { attacker: { clip, durationMs }, defender: HIT_REACTION, impactMs };
}

export function cuePose(cue: AnimationCue | null, now: number): { clip: Clip; key: string; elapsedSeconds: number } | null {
  if (!cue || now < cue.at || now >= cue.at + cue.durationMs) return null;
  return { clip: cue.clip, key: `${cue.seq}:${cue.role}`, elapsedSeconds: (now - cue.at) / 1000 };
}
