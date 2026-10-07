import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, Ray, Vector3 } from 'three';
import { SPAWN_TILE, SPIRE_EXIT, tileToWorld } from '@sim';
import { eventVisible, visibleHits, withVisibleFilter } from '../bosses/visibleEvents';
import { groundTileFromRay, setWalkViewerOnFloor } from '../Components/3D/walkTarget';
import { groundHover } from '../Components/3D/hoverTarget';
import { holdWalkTile } from '../Components/3D/HoldToWalk';
/** A mesh with R3F handlers of its own (eventCount > 0), as R3F marks it. */
const handled = (mesh: Mesh) => Object.assign(mesh, { __r3f: { eventCount: 1 } });
const hit = (object: Mesh) => ({ object, distance: 1 });

describe('visible-only Canvas events', () => {
  it('drops an intersection under an invisible ancestor and keeps a visible one', () => {
    const hidden = new Group(), shown = new Group();
    hidden.visible = false;
    const a = handled(new Mesh()), b = handled(new Mesh());
    hidden.add(new Group().add(a));
    shown.add(b);
    const hits = [hit(a), hit(b)];
    expect(visibleHits(hits)).toEqual([hit(b)]);
    expect(eventVisible(a)).toBe(false);
    expect(eventVisible(b)).toBe(true);
  });

  it('drops a hidden target with its own handlers but keeps an invisible hit proxy of a visible parent', () => {
    const disabled = handled(new Mesh());
    disabled.visible = false;
    expect(eventVisible(disabled)).toBe(false);
    // PlayerAvatar, TrainingDummy, Giant: an invisible click box under the clickable group.
    const avatar = handled(new Mesh()), proxy = new Mesh();
    proxy.visible = false;
    avatar.add(proxy);
    expect(eventVisible(proxy)).toBe(true);
  });

  it('returns the same array when nothing is hidden and composes with an existing filter', () => {
    const a = new Mesh(), b = new Mesh();
    const hits = [hit(a), hit(b)];
    expect(visibleHits(hits)).toBe(hits);
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(b);
    const previous = vi.fn((items: any[], _state: unknown) => [...items].reverse());
    const manager = withVisibleFilter(() => ({ priority: 1, filter: previous }))(null);
    expect(manager.priority).toBe(1);
    expect(manager.filter!(hits, {})).toEqual([hit(a)]);
    expect(previous).toHaveBeenCalledOnce();
    const bare: { filter?: (items: any[], state: unknown) => any[] } = {};
    expect(withVisibleFilter(() => bare)(null).filter!(hits, {})).toEqual([hit(a)]);
  });
});

const down = (tile: { x: number; z: number }) => new Ray(new Vector3(...tileToWorld(tile)).add(new Vector3(0, 8, 0)), new Vector3(0, -1, 0));
const floor = { x: 72, z: 68 };

describe('walk guards across the Spire floor boundary', () => {
  it('menus built from a click ray walk only on your side of the boundary', () => {
    expect(groundTileFromRay(down(floor))).toBeNull();
    expect(groundTileFromRay(down(SPAWN_TILE))).toEqual(SPAWN_TILE);
    setWalkViewerOnFloor(true);
    try {
      expect(groundTileFromRay(down(floor))).toEqual(floor);
      expect(groundTileFromRay(down(SPAWN_TILE))).toBeNull();
    } finally { setWalkViewerOnFloor(false); }
    expect(groundTileFromRay(down(floor), true)).toEqual(floor);
  });

  it('hover reads the floor as water from outside and the overworld as out of reach from inside', () => {
    expect(groundHover(floor, SPIRE_EXIT, new Set(), true, true)).toMatchObject({ title: 'Water', tone: 'muted' });
    expect(groundHover(SPIRE_EXIT, floor, new Set(), true, true)).toMatchObject({ title: 'Out of the arena', tone: 'muted' });
    expect(groundHover({ x: 73, z: 68 }, floor, new Set(), false, false)).toMatchObject({ title: 'Walk here' });
  });

  it('hold-to-walk follows the same rule on both branches', () => {
    for (const connected of [false, true]) {
      expect(holdWalkTile(floor, connected, false)).toBe(false);
      expect(holdWalkTile(floor, connected, true)).toBe(true);
      expect(holdWalkTile(SPAWN_TILE, connected, false)).toBe(true);
      expect(holdWalkTile(SPAWN_TILE, connected, true)).toBe(false);
    }
  });
});
