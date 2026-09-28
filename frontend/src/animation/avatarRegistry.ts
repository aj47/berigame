import type { Object3D } from 'three';

/**
 * identity hex -> that avatar's ground group (PlayerAvatar's group, which
 * carries position and facing). Lets a defender tell where a blow came from
 * (HitBack) without a server change. Filled by AdventurerModel.
 */
const groups = new Map<string, Object3D>();
const scratch = { x: 0, z: 0 };

export function registerAvatarGroup(identity: string, group: Object3D): void {
  groups.set(identity, group);
}

export function unregisterAvatarGroup(identity: string, group: Object3D): void {
  if (groups.get(identity) === group) groups.delete(identity);
}

/** Where an avatar stands now, or null. The returned object is reused: read it immediately. */
export function locateAvatar(identity: string): { x: number; z: number } | null {
  const group = groups.get(identity);
  if (!group) return null;
  scratch.x = group.position.x; scratch.z = group.position.z;
  return scratch;
}
