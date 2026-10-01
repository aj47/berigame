import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from 'three';
import { playersInHits } from '../Components/3D/playerSelection';
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
