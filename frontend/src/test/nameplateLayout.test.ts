import { describe, expect, it } from 'vitest';
import { visibleNameplates, type NameplateBounds } from '../Components/3D/nameplateLayout';
const box = (id: string, priority = 1, x = 0, y = 0): NameplateBounds => ({id, priority, left:x, right:x+80, top:y, bottom:y+16});
describe('crowded avatar name labels', () => {
  it('keeps You above target and ambient labels at the same spawn', () => {
    expect([...visibleNameplates([box('ambient'),box('target',2),box('you',3)])]).toEqual(['you']);
  });
  it('keeps a target over another nearby player, without hiding separate names', () => {
    expect([...visibleNameplates([box('ambient'),box('target',2),box('you',3,200)])]).toEqual(['you','target']);
  });
  it('resolves ties consistently and reveals separated labels again', () => {
    expect([...visibleNameplates([box('b'),box('a')])]).toEqual(['a']);
    expect([...visibleNameplates([box('a'),box('b',1,0,24)])]).toEqual(['a','b']);
  });
});
