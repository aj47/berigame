import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Ray, Raycaster, Scene, Vector2, Vector3 } from 'three';
import { SPAWN_TILE, tileToWorld } from '@sim';
import { groundTileFromRay } from '../Components/3D/walkTarget';
import { openMenuNear, TOUCH_TAP_RADIUS } from '../Components/3D/tapAssist';
import { useUserInputStore } from '../store';

beforeEach(() => useUserInputStore.getState().setClickedOtherObject(null));

describe('walking through an obstructing model', () => {
  it('targets the ground behind a tall model, rather than the surface that intercepted the ray', () => {
    const origin = new Vector3(...tileToWorld(SPAWN_TILE)).add(new Vector3(0, 8, 8));
    const destination = {...SPAWN_TILE, z: SPAWN_TILE.z - 4};
    const point = new Vector3(...tileToWorld(destination));
    const ray = new Ray(origin, point.clone().sub(origin).normalize());
    expect(groundTileFromRay(ray)).toEqual(destination);
    expect(ray.at(5, new Vector3()).y).toBeGreaterThan(0);
  });
  it('freezes a menu destination through ray reuse and choosing an overlapping player', () => {
    const point = new Vector3(...tileToWorld(SPAWN_TILE));
    const ray = new Ray(point.clone().add(new Vector3(0, 8, 0)), new Vector3(0, -1, 0));
    const select = useUserInputStore.getState().setClickedOtherObject;
    select({ connectionId: 'Choose player', playerChoices: ['a','b'], e: { ray } });
    ray.origin.x += 5;
    select({ ...useUserInputStore.getState().clickedOtherObject, playerHex: 'b' });
    expect(useUserInputStore.getState().clickedOtherObject.walkTile).toEqual(SPAWN_TILE);
  });
  it('uses the original pointer ray when touch assistance picks an object beside it', () => {
    const rect = { left: 0, top: 0, width: 200, height: 200 };
    const scene = new Scene(), camera = new PerspectiveCamera(50, 1, .1, 100);
    camera.position.set(0, 5, 5); camera.lookAt(0, 1, 0); camera.updateMatrixWorld();
    const object = new Group(); object.position.y = 1;
    object.add(new Mesh(new BoxGeometry(.5,.5,.5), new MeshBasicMaterial()));
    object.userData.hoverTarget = {title:'Tree',action:'Harvest'};
    const handler = vi.fn(e => useUserInputStore.getState().setClickedOtherObject({connectionId:'Tree',e}));
    (object as any).__r3f = {handlers:{onClick:handler}};
    scene.add(object); scene.updateMatrixWorld(true);
    const original = new Raycaster(); original.setFromCamera(new Vector2(.26, 0), camera);
    expect(original.intersectObject(object,true)).toHaveLength(0);
    expect(openMenuNear(scene,camera,rect,126,100,TOUCH_TAP_RADIUS)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(useUserInputStore.getState().clickedOtherObject.walkTile).toEqual(groundTileFromRay(original.ray));
    expect(useUserInputStore.getState().clickedOtherObject.walkTile).not.toBeNull();
  });
  it('rejects water, off-map points, missing rays, and rays facing away from the ground', () => {
    expect(groundTileFromRay()).toBeNull();
    expect(groundTileFromRay(new Ray(new Vector3(0,5,0),new Vector3(0,1,0)))).toBeNull();
    expect(groundTileFromRay(new Ray(new Vector3(-100,5,-100),new Vector3(0,-1,0)))).toBeNull();
    expect(groundTileFromRay(new Ray(new Vector3(...tileToWorld({x:0,z:0})).add(new Vector3(0,5,0)),new Vector3(0,-1,0)))).toBeNull();
  });
});
