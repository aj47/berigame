import type { Object3D } from 'three';

/**
 * R3F raycasts invisible meshes (three 0.149's Raycaster tests layers, not
 * `visible`), so a hidden object could still take a click or a hover and its
 * `stopPropagation` could swallow a floor click (FINAL_SPEC 7.4). The Canvas
 * gets `events={withVisibleFilter(events)}`: every intersection under a hidden
 * ancestor is dropped.
 *
 * The hit object itself counts as hidden only when it carries its own
 * handlers: an invisible child mesh with no handlers is the hit proxy of its
 * visible parent (the avatar, dummy, Giant and shrine click boxes), and stays.
 */
export function eventVisible(object: Object3D): boolean {
  const own = (object as Object3D & { __r3f?: { eventCount?: number } }).__r3f;
  if (!object.visible && (own?.eventCount ?? 0) > 0) return false;
  for (let o = object.parent; o; o = o.parent) if (!o.visible) return false;
  return true;
}

/** The intersections a player can actually see, in their original order. */
export function visibleHits<T extends { object: Object3D }>(hits: T[]): T[] {
  let keep = true;
  for (const h of hits) if (!eventVisible(h.object)) { keep = false; break; }
  return keep ? hits : hits.filter((h) => eventVisible(h.object));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Manager = { filter?: (items: any[], state: any) => any[] };

/** Wrap an R3F event-manager factory so its intersections pass `visibleHits` (after any filter it already had). */
export function withVisibleFilter<Store, M extends Manager>(create: (store: Store) => M): (store: Store) => M {
  return (store) => {
    const manager = create(store);
    const previous = manager.filter;
    return { ...manager, filter: (items, state) => visibleHits(previous ? previous(items, state) : items) };
  };
}
