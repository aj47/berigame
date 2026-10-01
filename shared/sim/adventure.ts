import { STICK_DROP_CHANCE } from './constants';
import { levelForXp } from './skills';
import { chebyshev } from './grid';
import type { Tile } from './types';

export const ADVENTURE_CAMP = { x: 22, z: 18 };
export const BERRY_PATCH = { x: 34, z: 17 };
export const BERRY_MARKET = { x: 35, z: 37 };
export const GIANT_FEAST = { x: 12, z: 36 };
export const ADVENTURE_TICKS = 600; // Six minutes; no real-time garden wait.
export const PATHS = ['Growing', 'Building', 'Exploring', 'Fighting', 'Befriending'] as const;
export const PATH_FIELDS = ['growingXp', 'buildingXp', 'exploringXp', 'fightingXp', 'befriendingXp'] as const;
export const Feat = { Grow: 1, Build: 2, Explore: 4, Protect: 8, Befriend: 16, Deliver: 32, Feed: 64 } as const;
export const TECHNIQUES = [
  { id: 0, key: 'seed_sense', name: 'Seed sense', path: 0, level: 2, feat: 1, description: 'Your expedition seed ripens in 6 seconds instead of 18.' },
  { id: 1, key: 'scent_mask', name: 'Scent mask', path: 0, level: 3, feat: 1, description: 'Hide a grounded berry for 30 seconds instead of 9. Carrying reveals it.' },
  { id: 2, key: 'giant_fruit', name: 'Giant fruit', path: 0, level: 4, feat: 32, description: 'Grow cargo worth two extra reward berries; its stronger scent wakes the Giant sooner.' },
  { id: 3, key: 'basket', name: 'Berry basket', path: 1, level: 2, feat: 2, description: 'Splitting off emergency food preserves the delivery reward.' },
  { id: 4, key: 'decoy', name: 'Scent decoy', path: 1, level: 3, feat: 2, description: 'Turn one driftwood into a 30-second Giant distraction where you stand.' },
  { id: 5, key: 'quiet_cart', name: 'Quiet cart', path: 1, level: 4, feat: 32, description: 'Moss takes two steps at a time. He still drops cargo when the Giant comes close.' },
  { id: 6, key: 'tracks', name: 'Read tracks', path: 2, level: 2, feat: 4, description: 'Track the hidden seed cache once per expedition for a goldberry and exploration XP.' },
  { id: 7, key: 'hidden_routes', name: 'Hidden routes', path: 2, level: 3, feat: 4, description: 'Roll the berry up to six tiles instead of three, along clear ground.' },
  { id: 8, key: 'false_trail', name: 'False trail', path: 2, level: 4, feat: 32, description: 'Rolling leaves a 15-second false scent at its old position.' },
  { id: 9, key: 'brace', name: 'Brace', path: 3, level: 2, feat: 8, description: 'Protect nearby cargo from the Giant for 12 seconds. Put the berry down first.' },
  { id: 10, key: 'shove', name: 'Shove', path: 3, level: 3, feat: 8, description: 'Chase Pip away for 24 seconds without spending food.' },
  { id: 11, key: 'interrupt', name: 'Interrupt', path: 3, level: 4, feat: 32, description: 'Stun the pursuing Giant for 9 seconds from within three tiles.' },
  { id: 12, key: 'snack_friend', name: 'Favourite snack', path: 4, level: 2, feat: 16, description: 'Bribing Pip keeps him friendly for 90 seconds instead of 30.' },
  { id: 13, key: 'porter', name: 'Porter pact', path: 4, level: 3, feat: 16, description: 'Moss carries for free and follows you instead of heading straight to market.' },
  { id: 14, key: 'giant_trust', name: 'Giant trust', path: 4, level: 4, feat: 64, description: 'A Giant you have fed waits 30 extra seconds before following your next berry.' },
] as const;
export type ProgressProfile = { growingXp: number; buildingXp: number; exploringXp: number; fightingXp: number; befriendingXp: number; feats: number; loadout: number };
export function hasTechnique(profile: { loadout: number } | null | undefined, id: number): boolean { return !!((profile?.loadout ?? 0) & (1 << id)); }
export function techniqueUnlocked(p: ProgressProfile, id: number): boolean {
  const def = TECHNIQUES.find(t => t.id === id);
  return !!def && levelForXp(p[PATH_FIELDS[def.path]]) >= def.level && (p.feats & def.feat) !== 0;
}
export function loadoutCount(mask: number): number { return TECHNIQUES.filter(t => mask & (1 << t.id)).length; }
export function canFindStick(level: number, claimed: boolean, roll: number): boolean { return level >= 2 && (!claimed || roll < STICK_DROP_CHANCE); }
export const EXPEDITION_ACTIONS = ['start', 'join', 'take', 'put_down', 'pass', 'roll', 'hide', 'split', 'bait', 'bribe', 'porter', 'deliver', 'feed', 'track', 'brace', 'shove', 'interrupt', 'leave'] as const;
export function cargoMovementSteps(carrying: boolean): number { return carrying ? 1 : 2; }
export function rollDestination(from: Tile, toward: Tile, distance: number, blocked: (tile: Tile) => boolean): Tile {
  let at = { ...from };
  for (let i = 0; i < distance; i++) {
    const next = { x: at.x + Math.sign(toward.x - at.x), z: at.z + Math.sign(toward.z - at.z) };
    if (chebyshev(next, at) === 0 || blocked(next)) break;
    if (next.x !== at.x && next.z !== at.z && (blocked({ x: next.x, z: at.z }) || blocked({ x: at.x, z: next.z }))) break;
    at = next;
  }
  return at;
}
export function expeditionReward(value: number, delivered: boolean): number { return delivered ? Math.max(1, Math.min(8, value)) : 0; }
export function duelHit(hp: number, damage: number): { hp: number; finished: boolean } { return { hp: Math.max(1, hp - damage), finished: hp - damage <= 1 }; }
