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

const near = { x: 0, z: 0, d2: Infinity };
let qx = 0, qz = 0;
const visit = (group: Object3D) => {
  const dx = group.position.x - qx, dz = group.position.z - qz, d2 = dx * dx + dz * dz;
  if (d2 < near.d2) { near.d2 = d2; near.x = group.position.x; near.z = group.position.z; }
};
/** The avatar nearest (x, z): its position and squared distance (d2 Infinity if none). Reused object; no allocation. */
export function nearestAvatar(x: number, z: number): { x: number; z: number; d2: number } {
  qx = x; qz = z; near.d2 = Infinity;
  groups.forEach(visit);
  return near;
}

/** Where an avatar stands now, or null. The returned object is reused: read it immediately. */
export function locateAvatar(identity: string): { x: number; z: number } | null {
  const group = groups.get(identity);
  if (!group) return null;
  scratch.x = group.position.x; scratch.z = group.position.z;
  return scratch;
}

/** Interpolated visual transform for a held prop. Callers must not mutate it. */
export const avatarGroup = (identity:string): Object3D | undefined => groups.get(identity);
