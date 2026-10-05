import { describe, expect, it } from 'vitest';
import { pieceClickable, pieceHoverAction, pieceUses } from '../frontier/pieceActions';
import type { Building } from '../../../shared/sim/frontier/model';

const piece = (name: string, extra: Partial<Building> = {}): Building =>
  ({ id: `piece-${name}`, claim: 'settlement-17', piece: name, region: 'settlement', x: 17, z: 85, rotation: 0, label: '', ...extra });
const visitor = { canBuild: false, hasSeed: false, now: 1_000 };
const helper = { ...visitor, canBuild: true };

describe('house piece clicks', () => {
  it('opens storage from a chest for visitors and helpers alike', () => {
    expect(pieceUses(piece('chest'), visitor)).toEqual([{ kind: 'storage', label: 'Open storage' }]);
    expect(pieceUses(piece('chest'), helper)[0].kind).toBe('storage');
    expect(pieceHoverAction(pieceUses(piece('chest'), visitor), false)).toBe('Click to open storage');
  });

  it('crafts at plot stations only for helpers, matching the server permit check', () => {
    for (const station of ['workbench', 'kiln', 'kitchen']) {
      expect(pieceUses(piece(station), helper)).toMatchObject([{ kind: 'craft', disabled: false }]);
      expect(pieceUses(piece(station), visitor)).toMatchObject([{ kind: 'craft', disabled: true }]);
    }
    expect(pieceHoverAction(pieceUses(piece('workbench'), helper), true)).toBe('Click to craft here');
  });

  it('tends planters: plant, wait, then harvest', () => {
    expect(pieceUses(piece('planter'), { ...helper, hasSeed: true })).toMatchObject([{ kind: 'plant', disabled: false }]);
    expect(pieceUses(piece('planter'), helper)).toMatchObject([{ kind: 'plant', disabled: true }]);
    const crop = { id: 'piece-planter', owner: 'me', item: 'carrot', region: 'settlement' as const, x: 17, z: 85, ripeAt: 5_000 };
    expect(pieceUses(piece('planter'), { ...helper, crop })).toMatchObject([{ kind: 'harvest', disabled: true }]);
    expect(pieceUses(piece('planter'), { ...helper, crop, now: 6_000 })).toMatchObject([{ kind: 'harvest', label: 'Harvest carrots', disabled: false }]);
    expect(pieceUses(piece('planter'), visitor)).toMatchObject([{ kind: 'approach' }]);
  });

  it('walks over to furniture and signs', () => {
    for (const name of ['table', 'chair', 'lamp']) expect(pieceUses(piece(name), visitor)).toMatchObject([{ kind: 'approach' }]);
    expect(pieceUses(piece('sign', { label: "techfren's Haiku Hall" }), visitor)[0].label).toBe("Walk to techfren's haiku hall");
  });

  it('lets clicks pass through floors, doorways and walls you are standing inside', () => {
    for (const name of ['floor', 'rug', 'door', 'gate']) {
      expect(pieceUses(piece(name), helper)).toEqual([]);
      expect(pieceClickable(piece(name), { canBuild: true, indoors: false, hasUses: false })).toBe(false);
    }
    for (const name of ['wall', 'window', 'fence']) {
      expect(pieceUses(piece(name), helper)).toEqual([]);
      expect(pieceClickable(piece(name), { canBuild: true, indoors: false, hasUses: false })).toBe(true);
      expect(pieceClickable(piece(name), { canBuild: true, indoors: true, hasUses: false })).toBe(false);
      expect(pieceClickable(piece(name), { canBuild: false, indoors: false, hasUses: false })).toBe(false);
    }
  });

  it('keeps every interior item clickable indoors so the chest and stations stay usable', () => {
    for (const name of ['chest', 'table', 'chair', 'lamp', 'workbench']) {
      const uses = pieceUses(piece(name), visitor);
      expect(pieceClickable(piece(name), { canBuild: false, indoors: true, hasUses: uses.length > 0 })).toBe(true);
    }
  });
});
