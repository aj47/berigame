import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { GARDEN_PLOT_TILES, SPAWN_TILE, TILE_ORIGIN, tileKey, tileToWorld, gardenPlotAt, worldToTile } from '@sim';
import { connectedGroundHover, groundHover, hoverRoots, hoverTargetOf, hoverTile, isWorldSurface, meadowBlockedTiles, resetHoverRootCache } from '../Components/3D/hoverTarget';
import { clickableNear, isDirectAttackClick, MOUSE_TAP_RADIUS, openMenuNear } from '../Components/3D/tapAssist';
import { useUserInputStore } from '../store';
import { homePoint, MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
import { frontierSnapshot } from '../../../shared/sim/frontier/snapshot';

const rect = { left: 0, top: 0, width: 200, height: 200 };
function fixture() {
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, .1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  function object(z = 0) {
    const root = new Group();
    root.position.z = z;
    const mesh = new Mesh(new BoxGeometry(.5, .5, .5), new MeshBasicMaterial());
    const handler = vi.fn(() => useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Tree' }));
    (root as any).__r3f = { handlers: { onClick: handler } };
    root.userData.hoverTarget = { title: 'Tree', action: 'Click for harvest options' };
    root.add(mesh); scene.add(root); scene.updateMatrixWorld(true);
    return { root, mesh, handler };
  }
  return { scene, camera, object };
}

beforeEach(() => { useUserInputStore.getState().setClickedOtherObject(null); resetHoverRootCache(); });

describe('world hover targeting', () => {
  it('accepts the pointer-transparent canvas wrapper but excludes UI and labels', () => {
    const connected = document.createElement('div'), wrapper = document.createElement('div'), canvas = document.createElement('canvas');
    const button = document.createElement('button');
    connected.append(wrapper, button); wrapper.append(canvas);
    expect(isWorldSurface(canvas, canvas, connected)).toBe(true);
    expect(isWorldSurface(wrapper, canvas, connected)).toBe(true);
    expect(isWorldSurface(connected, canvas, connected)).toBe(true);
    expect(isWorldSurface(button, canvas, connected)).toBe(false);
    expect(isWorldSurface(null, canvas, connected)).toBe(false);
  });
  it('resolves nested model metadata without invoking its click handler', () => {
    const f = fixture(), target = f.object();
    const picked = clickableNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS, t => !hoverTargetOf(t.hit.object, t.hit.point), hoverRoots(f.scene));
    expect(hoverTargetOf(picked!.hit.object, picked!.hit.point)?.root).toBe(target.root);
    expect(target.handler).not.toHaveBeenCalled();
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
  });

  it('previews and clicks the same nearby target with mouse click assist', () => {
    const f = fixture(), target = f.object();
    // The cube edge is ~111px; this point needs the shared 10px assist.
    const hit = clickableNear(f.scene, f.camera, rect, 118, 100, MOUSE_TAP_RADIUS, t => !hoverTargetOf(t.hit.object, t.hit.point), hoverRoots(f.scene));
    expect(hit?.object).toBe(target.root);
    expect(openMenuNear(f.scene, f.camera, rect, 118, 100, MOUSE_TAP_RADIUS)).toBe(true);
    expect(target.handler).toHaveBeenCalledTimes(1);
  });

  it('does not raycast terrain and scenery 17 times before an empty-ground click', () => {
    const f = fixture(), target = f.object();
    const terrain = new Mesh(new BoxGeometry(20, 20, .1), new MeshBasicMaterial());
    terrain.name = 'land_mesh'; terrain.position.z = -1;
    (terrain as any).__r3f = { handlers: { onClick: vi.fn() } };
    const scenery = new Mesh(new BoxGeometry(20, 20, .1), new MeshBasicMaterial());
    scenery.position.z = -2;
    f.scene.add(terrain, scenery); f.scene.updateMatrixWorld(true);
    const terrainRaycast = vi.spyOn(terrain, 'raycast'), sceneryRaycast = vi.spyOn(scenery, 'raycast');
    const targetRaycast = vi.spyOn(target.mesh, 'raycast');
    // The original full-scene path does all 17 probes, including geometry
    // that can never supply an object action, before falling back to walking.
    expect(clickableNear(f.scene, f.camera, rect, 180, 100, MOUSE_TAP_RADIUS, undefined, f.scene.children)).toBeNull();
    expect(terrainRaycast).toHaveBeenCalledTimes(17);
    expect(sceneryRaycast).toHaveBeenCalledTimes(17);
    vi.clearAllMocks();
    expect(openMenuNear(f.scene, f.camera, rect, 180, 100, MOUSE_TAP_RADIUS)).toBe(false);
    expect(terrainRaycast).not.toHaveBeenCalled();
    expect(sceneryRaycast).not.toHaveBeenCalled();
    expect(targetRaycast).toHaveBeenCalledTimes(17);
    expect(target.handler).not.toHaveBeenCalled();
  });

  it('reuses hover roots while the scene graph size is unchanged', () => {
    const f = fixture();
    f.object();
    const first = hoverRoots(f.scene);
    expect(hoverRoots(f.scene)).toBe(first);
    f.object(1);
    const next = hoverRoots(f.scene);
    expect(next).not.toBe(first);
    expect(next).toHaveLength(2);
  });

  it('preserves unannotated and nested clickable objects when filtering scenery', () => {
    const f = fixture(), target = f.object();
    delete target.root.userData.hoverTarget;
    const wrapper = new Group();
    f.scene.add(wrapper); wrapper.add(target.root);
    const nestedHandler = vi.fn(() => useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Nested' }));
    (target.mesh as any).__r3f = { handlers: { onClick: nestedHandler } };
    f.scene.updateMatrixWorld(true);
    expect(openMenuNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS)).toBe(true);
    expect(nestedHandler).toHaveBeenCalledOnce();
    expect(target.handler).not.toHaveBeenCalled();
  });

  it('chooses the front target and skips self/dead players for both hover and clicks', () => {
    const f = fixture(), back = f.object(), front = f.object(1);
    const pick = () => clickableNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS, t => !hoverTargetOf(t.hit.object, t.hit.point), hoverRoots(f.scene));
    expect(pick()?.object).toBe(front.root);
    front.root.userData.hoverTarget = null;
    expect(pick()?.object).toBe(back.root);
    expect(openMenuNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS)).toBe(true);
    expect(front.handler).not.toHaveBeenCalled();
    expect(back.handler).toHaveBeenCalledTimes(1);
  });

  it.each(['panel', 'action'])('counts a %s click as handled instead of also walking', click => {
    const f = fixture(), target = f.object();
    target.root.userData.hoverTarget.click = click;
    target.handler.mockImplementation(() => {});
    expect(openMenuNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS)).toBe(true);
    expect(target.handler).toHaveBeenCalledTimes(1);
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
  });

  it('uses click assistance to attack once, but preserves options for an explicit hold', () => {
    const f = fixture(), target = f.object(), attack = vi.fn();
    target.root.userData.hoverTarget.click = 'action';
    target.handler.mockImplementation((event: any) => {
      if (isDirectAttackClick(event, true)) attack();
      else useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Options' });
    });
    expect(openMenuNear(f.scene, f.camera, rect, 118, 100, MOUSE_TAP_RADIUS)).toBe(true);
    expect(attack).toHaveBeenCalledOnce();
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
    expect(openMenuNear(f.scene, f.camera, rect, 118, 100, MOUSE_TAP_RADIUS, undefined, 'menu')).toBe(true);
    expect(attack).toHaveBeenCalledOnce();
    expect(useUserInputStore.getState().clickedOtherObject).toMatchObject({ connectionId: 'Options' });
  });

  it('requires the toggle and a primary click for direct attacks', () => {
    expect(isDirectAttackClick({}, false)).toBe(false);
    expect(isDirectAttackClick({ button: 2 }, true)).toBe(false);
    expect(isDirectAttackClick({ nativeEvent: { button: 2 } }, true)).toBe(false);
  });

  it('evaluates changing status and resolves individual plots from the hit point', () => {
    const root = new Group(), mesh = new Mesh(); root.add(mesh);
    let ripe = false;
    root.userData.hoverTarget = (point: Vector3) => ({
      title: `Plot ${gardenPlotAt(worldToTile(point.x, point.z)) + 1}`,
      action: ripe ? 'Ready to harvest' : 'Growing',
    });
    const point = new Vector3(...tileToWorld(GARDEN_PLOT_TILES[3]));
    expect(hoverTargetOf(mesh, point)?.hint).toMatchObject({ title: 'Plot 4', action: 'Growing' });
    ripe = true;
    expect(hoverTargetOf(mesh, point)?.hint.action).toBe('Ready to harvest');
  });

  it('distinguishes explicitly inactive targets from unannotated scenery', () => {
    const root = new Group();
    expect(hoverTargetOf(root, new Vector3())).toBeUndefined();
    root.userData.hoverTarget = null;
    expect(hoverTargetOf(root, new Vector3())).toBeNull();
  });

  it.each(['land_mesh', 'worldSurface'])('never invokes connected terrain as a nearby object (%s)', marker => {
    const f = fixture(), terrain = f.object();
    delete terrain.root.userData.hoverTarget;
    if (marker === 'land_mesh') terrain.root.name = marker;
    else terrain.root.userData.worldSurface = true;
    terrain.root.position.set(64, 0, -39);
    f.camera.position.set(64, 0, -34); f.camera.updateMatrixWorld();
    f.scene.updateMatrixWorld(true);
    expect(openMenuNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS)).toBe(false);
    expect(terrain.handler).not.toHaveBeenCalled();
  });
});

describe('connected home walking previews', () => {
  const outside = { x: 61, z: 25, region: 'bramblewild' };
  const inside = { x: 4, z: 64, region: 'settlement' };
  const noBlocks = new Set<number>(), noBuildings = new Set<string>();
  const meadow = homePoint({ x: 5, z: 64 }, 'settlement');

  it('recognizes Meadows land beyond the original grid while approaching from the harbour', () => {
    const tile = hoverTile(meadow.x - TILE_ORIGIN, meadow.z - TILE_ORIGIN);
    expect(tile).toEqual(meadow);
    expect(connectedGroundHover(tile, outside, noBlocks, noBuildings, true, false)).toMatchObject({ title: 'Walk here', tile: meadow });
  });

  it('uses the player district coordinates when walking back into Bramblewild', () => {
    expect(connectedGroundHover({ x: 61, z: 25 }, inside, noBlocks, noBuildings, false, false)).toMatchObject({ title: 'Walk here', tile: { x: 61, z: 25 } });
    const farNorth = homePoint({ x: 31, z: 6 }, 'settlement');
    expect(farNorth.z).toBeLessThan(0);
    expect(connectedGroundHover(farNorth, inside, noBlocks, noBuildings, false, false)).toMatchObject({ title: 'Walk here', tile: farNorth });
  });

  it('keeps actual water on either side of the crossing non-walkable', () => {
    for (const tile of [{ x: 63, z: 15 }, homePoint({ x: 0, z: 50 }, 'settlement'), { x: MEADOW_OFFSET.x + 130, z: 25 }]) {
      expect(connectedGroundHover(tile, outside, noBlocks, noBuildings, true, true)).toMatchObject({ title: 'Water', tone: 'muted', tile });
    }
  });

  it('reports blocked building destinations rather than promising a nearby walk', () => {
    const blocked = new Set(['5,64']);
    expect(connectedGroundHover(meadow, outside, noBlocks, blocked, true, true)).toMatchObject({ title: 'Path blocked', tile: meadow, tone: 'muted' });
    expect(connectedGroundHover(homePoint({ x: 6, z: 64 }, 'settlement'), outside, noBlocks, blocked, true, true).title).toBe('Walk here');
  });

  it('checks the whole route and original-island barriers across the join', () => {
    const wall = new Set(Array.from({ length: 128 }, (_, z) => `2,${z}`));
    expect(connectedGroundHover(meadow, outside, noBlocks, wall, true, true).title).toBe('Path blocked');
    expect(connectedGroundHover(meadow, { ...SPAWN_TILE, region: 'bramblewild' }, noBlocks, noBuildings, false, false).title).toBe('Thorny brambles');
    expect(connectedGroundHover(meadow, { ...SPAWN_TILE, region: 'bramblewild' }, noBlocks, noBuildings, true, false).title).toBe('Walk here');
    expect(connectedGroundHover({ x: 54, z: 40 }, inside, noBlocks, noBuildings, true, false).title).toBe('Boulder boundary');
  });

  it('blocks solid pieces and private gates but allows an owner, permitted visitor or occupant to pass', () => {
    const state = frontierSnapshot([
      { kind: 'claim', data: JSON.stringify({ id: 'settlement-13', owner: 'owner', permissions: { guest: 1 }, tier: 0, paidUntil: 0, cooldownUntil: 0 }) },
      ...['wall', 'gate', 'floor'].map((piece, i) => ({ kind: 'building', data: JSON.stringify({ id: piece, region: 'settlement', x: 12 + i, z: 65, claim: 'settlement-13', piece, rotation: 0, label: '' }) })),
    ], [], 'visitor', 0);
    expect(meadowBlockedTiles(state, outside, 'visitor')).toEqual(new Set(['12,65', '13,65']));
    expect(meadowBlockedTiles(state, outside, 'owner')).toEqual(new Set(['12,65']));
    expect(meadowBlockedTiles(state, outside, 'guest')).toEqual(new Set(['12,65']));
    expect(meadowBlockedTiles(state, { region: 'settlement', x: 14, z: 66 }, 'visitor')).toEqual(new Set(['12,65']));
  });
});

describe('walking previews', () => {
  it('does not turn ocean outside the map into a shore destination', () => {
    const tile = hoverTile(-TILE_ORIGIN - 8, -TILE_ORIGIN - 8);
    expect(tile.x).toBe(-8);
    expect(groundHover(tile, SPAWN_TILE, new Set(), false, false)).toMatchObject({ title: 'Water', tone: 'muted' });
  });

  it('highlights the real nearby destination when scenery blocks the clicked tile', () => {
    const tile = { x: SPAWN_TILE.x + 1, z: SPAWN_TILE.z };
    const blocked = new Set([tileKey(tile)]);
    const hint = groundHover(tile, SPAWN_TILE, blocked, true, true);
    expect(hint.title).toBe('Walk nearby');
    expect(blocked.has(tileKey(hint.tile!))).toBe(false);
  });

  it('explains a missing key and updates when the player carries it', () => {
    const coast = { x: 44, z: 25 };
    expect(groundHover(coast, SPAWN_TILE, new Set(), false, false)).toMatchObject({ title: 'Thorny brambles', detail: 'Carry a sturdy stick to cross' });
    expect(groundHover(coast, SPAWN_TILE, new Set(), true, false)).toMatchObject({ title: 'Walk here', tile: coast });
  });
});
