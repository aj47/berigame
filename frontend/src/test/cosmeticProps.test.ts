import { Box3, Vector3 } from 'three';
import { COSMETICS, Cosmetic } from '@sim';
import { cosmeticGeometry } from '../Components/3D/cosmeticProps';
import { triangleCount } from '../Components/3D/nodes/lowPoly';

describe('keepsake models', () => {
  it('has shared geometry for every earnable keepsake', () => {
    for (const cosmetic of COSMETICS) {
      const geometry = cosmeticGeometry(cosmetic.id);
      expect(geometry, cosmetic.name).not.toBeNull();
      expect(cosmeticGeometry(cosmetic.id)).toBe(geometry);
    }
  });

  it('fits the Berry Heart below the neck and keeps the pendant inexpensive to render', () => {
    const geometry = cosmeticGeometry(Cosmetic.BerryHeart)!;
    expect(triangleCount(geometry)).toBeLessThan(200);
    const positions = geometry.getAttribute('position');
    expect(geometry.getAttribute('color').count).toBe(positions.count);
    const box = new Box3().setFromBufferAttribute(positions as any);
    expect(box.min.y).toBeLessThan(-.19);
    expect(box.max.y).toBeLessThan(.04);
    expect(box.max.z).toBeGreaterThan(.23);
    expect(box.getSize(new Vector3()).length()).toBeLessThan(.65);
  });
});
