import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Ray, Scene, Vector3 } from 'three';
import { tileToWorld } from '@sim';
import { avatarSelection, playersInHits } from '../Components/3D/playerSelection';
import { openMenuNear, TOUCH_TAP_RADIUS } from '../Components/3D/tapAssist';
import { useUserInputStore } from '../store';

const rect = { left: 0, top: 0, width: 200, height: 200 };
function fixture() {
  const scene = new Scene(), camera = new PerspectiveCamera(50, 1, .1, 100);
  camera.position.z = 5; camera.updateMatrixWorld();
  const avatar = (hex: string, z: number, selectable = true) => {
    const root = new Group(); root.position.z = z;
    root.userData.hoverTarget = selectable ? { title: hex, playerHex: hex, action: 'Player actions' } : null;
    const mesh = new Mesh(new BoxGeometry(.5, .5, .5), new MeshBasicMaterial());
    const nested = new Group(); nested.add(mesh); root.add(nested); scene.add(root);
    const handler = vi.fn(event => useUserInputStore.getState().setClickedOtherObject({ playerChoices: playersInHits(event.intersections).map(p => p.hex) }));
    (root as any).__r3f = { handlers: { onClick: handler } };
    scene.updateMatrixWorld(true);
    return { root, mesh, handler };
  };
  return { scene, camera, avatar };
}
beforeEach(() => useUserInputStore.getState().setClickedOtherObject(null));

describe('overlapping player selection', () => {
  it('finds players behind each other and deduplicates body, hitbox, and cosmetic hits by identity', () => {
    const f = fixture(), front = f.avatar('front', 1), back = f.avatar('back', 0);
    const hits = [front.mesh, front.root, back.mesh, back.root, front.mesh].map(object => ({ object, point: new Vector3() }));
    expect(playersInHits(hits)).toEqual([{ hex: 'front', name: 'front' }, { hex: 'back', name: 'back' }]);
    expect(front.handler).not.toHaveBeenCalled(); expect(back.handler).not.toHaveBeenCalled();
  });
  it('excludes self, dead players, and non-player objects', () => {
    const f = fixture(), self = f.avatar('self', 2, false), dead = f.avatar('dead', 1, false), player = f.avatar('other', 0);
    self.root.userData.hoverTarget = { title: 'You', action: 'Click for ground actions', tile: { x: 25, z: 25 } };
    const tree = new Group(); tree.userData.hoverTarget = { title: 'Tree', action: 'Harvest' };
    expect(playersInHits([self.mesh, dead.mesh, tree, player.mesh].map(object => ({ object, point: new Vector3() })))).toEqual([{ hex: 'other', name: 'other' }]);
  });
  it('preserves every player hit when touch assistance synthesizes a click', () => {
    const f = fixture(), back = f.avatar('back', 0), front = f.avatar('front', 1), self = f.avatar('self', 2, false);
    // Outside both meshes: the touch radius supplies the ray through the overlapping pair.
    expect(openMenuNear(f.scene, f.camera, rect, 126, 100, TOUCH_TAP_RADIUS)).toBe(true);
    expect(useUserInputStore.getState().clickedOtherObject.playerChoices).toEqual(['front', 'back']);
    expect(front.handler).toHaveBeenCalledOnce();
    expect(back.handler).not.toHaveBeenCalled(); expect(self.handler).not.toHaveBeenCalled();
  });
  it('leaves unrelated players outside the pointer ray out of the choices', () => {
    const f = fixture(), front = f.avatar('front', 1), aside = f.avatar('aside', 1);
    aside.root.position.x = 2; f.scene.updateMatrixWorld(true);
    openMenuNear(f.scene, f.camera, rect, 100, 100, TOUCH_TAP_RADIUS);
    expect(useUserInputStore.getState().clickedOtherObject.playerChoices).toEqual(['front']);
    expect(aside.handler).not.toHaveBeenCalled(); expect(front.handler).toHaveBeenCalledOnce();
  });
});

describe('avatar ground selection', () => {
  const self = () => ({ hex: 'self', name: 'My character', x: 25, z: 25, isSelf: true });
  const hitsFor = (...objects: Group[]) => objects.map(object => ({ object, point: new Vector3() }));

  it('opens own ground actions without offering self player actions', () => {
    expect(avatarSelection(self(), [])).toEqual({ connectionId: 'You', groundTiles: [{ x: 25, z: 25 }], dropdownOptions: [] });
  });

  it('keeps frozen feet tiles distinct from the ground behind an avatar', () => {
    const f = fixture(), player = f.avatar('other', 1);
    const feet = { x: 25, z: 25 };
    player.root.userData.hoverTarget.tile = feet;
    const avatar = { hex: 'other', name: 'Other', ...feet, isSelf: false };
    const destination = { x: 25, z: 21 };
    const ray = new Ray(new Vector3(...tileToWorld(destination)).add(new Vector3(0, 8, 0)), new Vector3(0, -1, 0));
    useUserInputStore.getState().setClickedOtherObject({ ...avatarSelection(avatar, hitsFor(player.root)), e: { ray } });
    feet.x = 30; avatar.z = 30; ray.origin.x += 5;
    const selected = useUserInputStore.getState().clickedOtherObject;
    expect(selected.groundTiles).toEqual([{ x: 25, z: 25 }]);
    expect(selected.walkTile).toEqual(destination);
  });

  it('keeps each crowded player’s feet once and copies the hint tiles', () => {
    const f = fixture(), front = f.avatar('front', 1), back = f.avatar('back', 0);
    front.root.userData.hoverTarget.tile = { x: 25, z: 25 };
    back.root.userData.hoverTarget.tile = { x: 25, z: 26 };
    const hits = hitsFor(front.root, front.root, back.root);
    const players = playersInHits(hits);
    const selected = avatarSelection(self(), hits);
    expect(selected.playerChoices).toEqual(['front', 'back']);
    expect(selected.playerHex).toBeUndefined();
    expect(selected.connectionId).toBe('Choose player');
    expect(selected.groundTiles).toEqual([{ x: 25, z: 25 }, { x: 25, z: 26 }]);
    back.root.userData.hoverTarget.tile.z = 29;
    expect(players[1].tile).toEqual({ x: 25, z: 26 });
    expect(selected.groundTiles[1]).toEqual({ x: 25, z: 26 });
  });

  it('selects the other player behind your avatar using that player’s identity and name', () => {
    const f = fixture(), player = f.avatar('other', 1);
    const selected = avatarSelection(self(), hitsFor(player.root));
    expect(selected).toMatchObject({ connectionId: 'other', playerChoices: ['other'], playerHex: 'other', groundTiles: [{ x: 25, z: 25 }] });
  });

  it('includes the clicked player when their mesh is absent from the hit list', () => {
    const selected = avatarSelection({ ...self(), hex: 'other', name: 'Other', isSelf: false }, []);
    expect(selected).toMatchObject({ connectionId: 'Other', playerChoices: ['other'], playerHex: 'other', groundTiles: [{ x: 25, z: 25 }] });
  });

  it('lets touch assistance open your own ground menu', () => {
    const f = fixture(), own = f.avatar('self', 2, false);
    own.root.userData.hoverTarget = { title: 'You', action: 'Click for ground actions', tile: { x: 25, z: 25 } };
    const handler = vi.fn(e => useUserInputStore.getState().setClickedOtherObject({ ...avatarSelection(self(), e.intersections), e }));
    (own.root as any).__r3f = { handlers: { onClick: handler } };
    expect(openMenuNear(f.scene, f.camera, rect, 126, 100, TOUCH_TAP_RADIUS)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(useUserInputStore.getState().clickedOtherObject).toMatchObject({ connectionId: 'You', dropdownOptions: [], groundTiles: [{ x: 25, z: 25 }] });
    expect(useUserInputStore.getState().clickedOtherObject.playerChoices).toBeUndefined();
  });
});
