import { EventKind, STONE_CLUB_ITEM_ID, isWeapon } from '@sim';
import { locateAvatar } from '../animation/avatarRegistry';
import { audio } from '../audio';
import type { SfxName } from '../audio/synth';
import { flashAt } from './hitFlash';
import { reactAt } from './hitReaction';
import { FxKind, FxQueue } from './fxQueue';

/** Impacts waiting for their frame (drained by FxLayer). */
export const fxQueue = new FxQueue(32);

/** The Defeat clip's body reaches the ground about this long after the death arrives. */
export const DEATH_THUD_MS = 650;
/** A found item floats up after the harvest '+1' (combatFxStore FIND_DELAY_MS). */
const FIND_CHIME_MS = 550;

/** 0 fist, 1 stick (or any other weapon), 2 stone club. */
export const weaponWeight = (itemId: string) => (itemId === STONE_CLUB_ITEM_ID ? 2 : itemId && isWeapon(itemId) ? 1 : 0);
const HIT_SOUND: readonly SfxName[] = ['punch', 'stick', 'club'];

function playAt(name: SfxName, identity: string, volume: number, delayMs = 0, detune = 0.05): void {
  const where = locateAvatar(identity);
  if (where) audio.play(name, { volume, delayMs, detune, x: where.x, z: where.z });
  else audio.play(name, { volume: volume * 0.5, delayMs, detune });
}

/**
 * Sound and visual effects for one committed combat_event, called by
 * combatFxStore.pushEvent (which owns the animation cues). `at` is the
 * event's arrival (performance.now()), `impactMs` when the blow lands.
 */
export function onCombatEvent(kind: number, itemId: string, attacker: string, defender: string, at: number, impactMs: number): void {
  switch (kind) {
    case EventKind.Hit: {
      const weight = weaponWeight(itemId);
      // The swing's whoosh leads the impact; a jab is too quick for much of one.
      playAt('whoosh', attacker, weight ? 0.8 : 0.45, Math.max(0, impactMs - (weight ? 230 : 120)), 0.08);
      playAt(HIT_SOUND[weight], defender, 1, impactMs);
      flashAt(defender, at + impactMs);
      // Knockback away from the attacker, and a hitstop on stick/club blows.
      const from = locateAvatar(attacker);
      const ax = from?.x ?? 0, az = from?.z ?? 0;
      const to = from ? locateAvatar(defender) : null;
      reactAt(defender, attacker, at + impactMs, weight, to ? to.x - ax : 0, to ? to.z - az : 0);
      fxQueue.push(at + impactMs, FxKind.Impact, defender, attacker, weight);
      break;
    }
    case EventKind.Death:
      playAt('thud', defender, 1, DEATH_THUD_MS, 0);
      break;
    case EventKind.Eat:
      playAt('eat', defender, 0.9);
      break;
    case EventKind.HarvestDone:
      playAt('pop', defender, 0.9, 0, 0.08);
      break;
    case EventKind.ItemFound:
      playAt('chime', defender, 1, FIND_CHIME_MS, 0);
      break;
    default:
      break;
  }
}
