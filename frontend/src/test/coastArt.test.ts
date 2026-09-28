import { Box3, Vector3 } from 'three';
import { driftwoodPileGeometry } from '../Components/3D/nodes/DriftwoodPile';
import { tideRockGeometry } from '../Components/3D/nodes/TideRock';
import { clubGeometry, clubMaterial } from '../Components/3D/clubProp';
import { coastMaterial, triangleCount } from '../Components/3D/nodes/lowPoly';
import { STICK_LENGTH } from '../animation/stickSwing';
import { attackPresentation } from '../animation/combatPresentation';
import { EventKind } from '@sim';

describe('M2 Coast art', () => {
  const nodes = { driftwood: driftwoodPileGeometry, tideRock: tideRockGeometry };
  for (const [name, geometry] of Object.entries(nodes)) {
    for (const ripe of [true, false]) {
      it(`${name} (${ripe ? 'ripe' : 'regrowing'}) is low-poly, vertex-coloured, shared and sits on the ground`, () => {
        const g = geometry(ripe);
        expect(g).toBe(geometry(ripe));
        expect(triangleCount(g)).toBeLessThan(300);
        expect(g.getAttribute('color').count).toBe(g.getAttribute('position').count);
        const box = new Box3().setFromBufferAttribute(g.getAttribute('position') as any);
        expect(box.min.y).toBeGreaterThan(-0.2);
        expect(box.max.y).toBeLessThan(1.6);
        expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeLessThan(1.9);
      });
    }
    it(`${name} states differ`, () => expect(geometry(true)).not.toBe(geometry(false)));
  }

  it('the club is modelled along +Y like the stick and shares the Coast material', () => {
    const g = clubGeometry();
    expect(triangleCount(g)).toBeLessThan(300);
    const box = new Box3().setFromBufferAttribute(g.getAttribute('position') as any);
    expect(box.min.y).toBeCloseTo(0, 1);
    expect(box.max.y).toBeGreaterThan(STICK_LENGTH - 0.05);
    expect(box.max.y).toBeLessThan(STICK_LENGTH + 0.15);
    expect(box.getSize(new Vector3()).x).toBeLessThan(0.4);
    expect(clubMaterial()).toBe(coastMaterial());
  });

  it('the club swings like the stick and lands as heavily', () => {
    expect(attackPresentation(EventKind.Hit, 'stone_club')).toEqual(attackPresentation(EventKind.Hit, 'stick'));
    expect(attackPresentation(EventKind.Hit, 'stone_club')).not.toEqual(attackPresentation(EventKind.Hit, ''));
  });

  it('the driftwood pile reads on pale sand: darker than the sand, bigger than a tile', () => {
    const g = driftwoodPileGeometry(true);
    const c = g.getAttribute('color');
    let sum = 0;
    for (let i = 0; i < c.count; i++) sum += (c.getX(i) + c.getY(i) + c.getZ(i)) / 3;
    expect(sum / c.count).toBeLessThan(0.3);
    const box = new Box3().setFromBufferAttribute(g.getAttribute('position') as any);
    expect(box.max.x - box.min.x).toBeGreaterThan(1.4);
  });
});
