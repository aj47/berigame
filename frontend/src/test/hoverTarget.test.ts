import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { GARDEN_PLOT_TILES, SPAWN_TILE, TILE_ORIGIN, tileKey, tileToWorld, gardenPlotAt, worldToTile } from '@sim';
import { groundHover, hoverRoots, hoverTargetOf, hoverTile, isWorldSurface } from '../Components/3D/hoverTarget';
import { clickableNear, MOUSE_TAP_RADIUS, openMenuNear } from '../Components/3D/tapAssist';
import { useUserInputStore } from '../store';

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

beforeEach(() => useUserInputStore.getState().setClickedOtherObject(null));

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

  it('counts an adventure panel click as handled instead of also walking', () => {
    const f = fixture(), target = f.object();
    target.root.userData.hoverTarget.click = 'panel';
    target.handler.mockImplementation(() => {});
    expect(openMenuNear(f.scene, f.camera, rect, 100, 100, MOUSE_TAP_RADIUS)).toBe(true);
    expect(target.handler).toHaveBeenCalledTimes(1);
    expect(useUserInputStore.getState().clickedOtherObject).toBeNull();
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
