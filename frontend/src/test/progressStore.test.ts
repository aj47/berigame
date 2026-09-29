import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Cosmetic, xpForLevel } from '@sim';
import { progressHooks, useProgressStore } from '../spacetime/stores/progressStore';

const row = (f = 0, b = 0, c = 0) => ({ foragingXp: f, beachcombingXp: b, craftingXp: c });

describe('XP floaters and the level-up banner', () => {
  beforeEach(() => useProgressStore.setState({ xpFloat: null, banner: null }));

  it('a gain floats "+N Skill" without a banner', () => {
    useProgressStore.getState().onSkills(row(8), row(16));
    expect(useProgressStore.getState().xpFloat?.text).toBe('+8 Foraging');
    expect(useProgressStore.getState().banner).toBeNull();
  });

  it('crossing a level shows a banner and plays the fanfare hook; L10 names its keepsake', () => {
    const played = vi.fn();
    progressHooks.onMilestone = played;
    useProgressStore.getState().onSkills(row(xpForLevel(10) - 2), row(xpForLevel(10) + 6));
    expect(useProgressStore.getState().banner).toMatchObject({ kind: 'level', title: 'Foraging level 10!', detail: 'Unlocked: Flower Crown' });
    expect(played).toHaveBeenCalledTimes(1);
    useProgressStore.getState().onSkills(row(0, 0, 20), row(0, 0, 40));
    expect(useProgressStore.getState().banner).toMatchObject({ title: 'Crafting level 2!', detail: 'New recipe: Flint Knife' });
    progressHooks.onMilestone = () => {};
  });

  it('a milestone keepsake (not a skill one) gets its own banner', () => {
    useProgressStore.getState().onCosmetics(0, 1 << Cosmetic.StrawHat);
    expect(useProgressStore.getState().banner).toMatchObject({ kind: 'cosmetic', title: 'New keepsake: Straw Hat' });
    useProgressStore.setState({ banner: null });
    useProgressStore.getState().onCosmetics(0, 1 << Cosmetic.FlowerCrown);
    expect(useProgressStore.getState().banner).toBeNull();
  });
});
