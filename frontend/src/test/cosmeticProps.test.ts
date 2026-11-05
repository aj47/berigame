import { Box3, Vector3 } from 'three';
import { COSMETICS, Cosmetic, CosmeticSlot } from '@sim';
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

  it('keeps every keepsake within the triangle budget with a colour per vertex', () => {
    for (const cosmetic of COSMETICS) {
      const geometry = cosmeticGeometry(cosmetic.id)!;
      expect(triangleCount(geometry), cosmetic.name).toBeLessThanOrEqual(250);
      expect(geometry.getAttribute('color').count, cosmetic.name).toBe(geometry.getAttribute('position').count);
    }
  });

  it('builds a distinct model for each Long Season keepsake, sized to its bone', () => {
    const season = COSMETICS.filter((c) => c.id >= Cosmetic.GlowcapCap);
    expect(season).toHaveLength(14);
    const shapes = new Set<string>();
    for (const cosmetic of season) {
      const geometry = cosmeticGeometry(cosmetic.id)!;
      const box = new Box3().setFromBufferAttribute(geometry.getAttribute('position') as any);
      // Every piece stays within a head's or a torso's reach of its bone.
      expect(box.getSize(new Vector3()).length(), cosmetic.name).toBeLessThan(cosmetic.slot === CosmeticSlot.Head ? 1.1 : 0.9);
      if (cosmetic.slot === CosmeticSlot.Head) expect(box.min.y, cosmetic.name).toBeGreaterThan(0.15);
      shapes.add(`${triangleCount(geometry)}:${box.max.y.toFixed(3)}:${box.min.y.toFixed(3)}`);
    }
    expect(shapes.size).toBe(season.length);
  });
});
