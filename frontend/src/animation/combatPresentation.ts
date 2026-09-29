import { EventKind, isWeapon } from '@sim';
import { STICK_SWING_CLIP, STICK_SWING_IMPACT_MS, STICK_SWING_MS } from './stickSwing';
import { EMOTE_CLIPS } from './emotes';

/**
 * Every clip an adventurer plays: locomotion (Stop settles a run), the two
 * attacks, the hit reactions (HitBack when struck from behind), defeat and
 * GetUp on respawn, and the synthesized emotes (animation/emotes.ts).
 */
export const CLIPS = ['Idle', 'Run', 'Stop', 'Strike', STICK_SWING_CLIP, 'Hit', 'HitHeavy', 'HitBack', 'Defeat', 'GetUp', 'StickIdle', 'StickRun', 'StickStop', ...EMOTE_CLIPS] as const;
/** Idle, Run and Stop while a stick is wielded (the arm holds the stick); played in their place by avatarAnimator.ts. */
export const ARMED_VARIANT: Readonly<Partial<Record<Clip, Clip>>> = { Idle: 'StickIdle', Run: 'StickRun', Stop: 'StickStop' };
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
  /** Plays once this cue ends: a hit reaction queued behind the defender's own swing. */
  then?: AnimationCue;
  /** A reaction's attacker (identity hex), so the defender can tell a blow from behind. */
  attacker?: string;
}

/** A blow from further behind than this (cosine of the angle off the defender's facing) plays HitBack. */
export const BEHIND_COS = -0.35;
/**
 * Whether an attacker at (ax, az) is behind a defender at (dx, dz) facing
 * `yaw` (the avatar group's rotation.y: facing is (sin yaw, cos yaw)).
 * Beside counts as in front, so only a clear rear attack plays HitBack.
 */
export function isBehind(dx: number, dz: number, yaw: number, ax: number, az: number): boolean {
  const x = ax - dx, z = az - dz, length = Math.hypot(x, z);
  if (length < 1e-6) return false;
  return (x * Math.sin(yaw) + z * Math.cos(yaw)) / length < BEHIND_COS;
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
/** A stick blow: a harder recoil with a bigger step back (falls back to Hit on a rig without it). */
const HEAVY_HIT_REACTION: ActionCue = { clip: 'HitHeavy', durationMs: 550 };

/**
 * How one swing looks, from the committed event: `itemId` is what the
 * attacker held when the server resolved the swing ('' = punch). Never read
 * the live player row here; it may already have changed.
 */
export function attackPresentation(kind: number, itemId: string): AttackPresentation | null {
  if (kind !== EventKind.Hit) return null;
  // The stone club swings like the stick (StickSwing) and lands as heavily.
  const armed = !!itemId && isWeapon(itemId);
  const { clip, durationMs, impactMs } = armed ? STICK_ATTACK : PUNCH_ATTACK;
  return { attacker: { clip, durationMs }, defender: armed ? HEAVY_HIT_REACTION : HIT_REACTION, impactMs };
}

/** The cue in a chain that is playing or next up at `now`: follows `then` past cues that have ended. */
export function currentCue(cue: AnimationCue | null | undefined, now: number): AnimationCue | null {
  let c = cue ?? null;
  while (c && c.then && now >= c.at + c.durationMs) c = c.then;
  return c;
}

export function cuePose(cue: AnimationCue | null | undefined, now: number): { clip: Clip; key: string; elapsedSeconds: number } | null {
  if (!cue) return null;
  if (now >= cue.at + cue.durationMs) return cuePose(cue.then, now);
  if (now < cue.at) return null;
  return { clip: cue.clip, key: `${cue.seq}:${cue.role}`, elapsedSeconds: (now - cue.at) / 1000 };
}
