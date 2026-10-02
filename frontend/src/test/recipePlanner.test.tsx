import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getRecipe } from '@sim';
import RecipePlanner from '../site/RecipePlanner';
import { MAX_PLAN_QUANTITY, parseRecipeQuantity, planRecipe } from '../site/recipePlannerData';

describe('recipe planner', () => {
  it('scales source ingredients, outputs and XP for a real multi-craft plan', () => {
    const plan = planRecipe(getRecipe('stone_club')!, '12')!;
    expect(plan.ingredients.map(ingredient => [ingredient.name, ingredient.quantity])).toEqual([['Driftwood', 12], ['Flint Shard', 24]]);
    expect(plan.outputQuantity).toBe(12);
    expect(plan.xp).toBe(480);
    expect(plan.requiredXp).toBe(0);
    expect(plan.ingredients[1].href).toBe('/docs/item-flint');
    expect(plan.outputHref).toBe('/docs/item-stone-club');
  });

  it('rejects missing, fractional, negative and unbounded quantities', () => {
    for (const value of ['', ' ', '-1', '0', '1.5', '2e2', 'NaN', 'Infinity', String(MAX_PLAN_QUANTITY + 1)]) {
      expect(parseRecipeQuantity(value), value).toBeNull();
      expect(planRecipe(getRecipe('berry_mash')!, value), value).toBeNull();
    }
    expect(parseRecipeQuantity('1')).toBe(1);
    expect(parseRecipeQuantity(String(MAX_PLAN_QUANTITY))).toBe(MAX_PLAN_QUANTITY);
  });

  it('treats a cosmetic as a one-time unlock and uses its real level threshold', () => {
    const crown = getRecipe('driftwood_crown')!;
    expect(planRecipe(crown, '2')).toBeNull();
    expect(planRecipe(crown, '1')).toMatchObject({ quantity: 1, xp: 30, requiredXp: 400, outputQuantity: 1, outputHref: '/docs/skills-progression#keepsakes' });
  });

  it('updates the visible plan and resets quantity when selecting a one-time keepsake', () => {
    render(<RecipePlanner />);
    const quantity = screen.getByRole('spinbutton', { name: 'Number of crafts' });
    fireEvent.change(quantity, { target: { value: '10' } });
    expect(screen.getByRole('status')).toHaveTextContent('10 Driftwood and 20 Flint Shard');
    expect(screen.getByRole('status')).toHaveTextContent('400 Crafting XP');
    fireEvent.click(within(screen.getByRole('group', { name: 'Choose a recipe' })).getByRole('button', { name: /Driftwood Crown/ }));
    expect(quantity).toHaveValue(1);
    expect(quantity).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Increase craft quantity' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('3 Driftwood and 1 Flint Shard');
    expect(screen.getByRole('status')).toHaveTextContent('Unlock Driftwood Crown');
  });

  it('hides misleading totals for invalid input and recovers after clearing the field', () => {
    render(<RecipePlanner />);
    const quantity = screen.getByRole('spinbutton', { name: 'Number of crafts' });
    fireEvent.change(quantity, { target: { value: '1.5' } });
    expect(quantity).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Enter a valid quantity');
    fireEvent.change(quantity, { target: { value: '' } });
    fireEvent.blur(quantity);
    expect(quantity).toHaveValue(1);
    expect(quantity).not.toHaveAttribute('aria-invalid');
    expect(screen.getByRole('status')).toHaveTextContent('1 Driftwood and 2 Flint Shard');
  });
});
