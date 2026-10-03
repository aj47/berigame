import React, { memo, useMemo, useRef, useState } from 'react';
import { getItemDef, hasCosmetic, levelForXp, recipeStatus } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyCosmetics, useMySkills, useMyPlayer } from '../spacetime/hooks';
import { slotsFromRows } from './itemUi';
import './crafting.css';
import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import { frontierRecipeStatus } from './craftingModel';
import { foodHealing } from '../../../shared/sim/frontier/engine';

const CraftingPanel = memo(({ open, onClose, frontier }: { open: boolean; onClose: () => void; frontier?: FrontierSnapshot }) => {
  const rows = useInventoryRows();
  const me = useMyPlayer();
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
  const slots = useMemo(() => slotsFromRows(rows), [rows]);
  const craftingLevel = levelForXp(skills?.craftingXp ?? 0);
  const { craft, frontier: frontierAction } = useGameActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError('');
    try {
      if (await action() === false) setError('Could not craft. Check your supplies and try again.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not craft. Try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (!open) return null;
  const recipes = [
    ...recipeStatus(slots, craftingLevel).map(recipe => {
      const output = recipe.output ? getItemDef(recipe.output.itemId) : null;
      const owned = recipe.cosmetic !== null && hasCosmetic(cosmetics?.unlocked ?? 0, recipe.cosmetic);
      return {
        id: recipe.id, name: recipe.name, quantity: recipe.output?.quantity ?? 1,
        icon: output?.icon ?? `/items/${recipe.id}.png`,
        description: output?.weaponDamage ? `${output.weaponDamage} damage` : output?.healthRestore ? `Heals ${foodHealing(output.healthRestore, frontier?.profile)} HP` : 'Keepsake',
        canCraft: recipe.canCraft && !owned, locked: recipe.locked, owned,
        inputs: recipe.inputs.map(input => ({ ...input, have: slots.reduce((total, slot) => total + (slot?.itemId === input.itemId ? slot.quantity : 0), 0) })),
        requirement: recipe.locked ? `Requires Crafting level ${recipe.level}.` : `+${recipe.xp} Crafting XP · Make anywhere.`,
        make: () => craft(recipe.id),
      };
    }),
    ...(frontier?.enabled ? frontier.recipes.map(recipe => {
      const output = getItemDef(recipe.output);
      const status = frontierRecipeStatus(recipe, frontier, me, slots);
      return {
        id: recipe.id, name: output?.name ?? recipe.output, icon: output?.icon,
        description: output?.weaponDamage ? `${output.weaponDamage} damage` : output?.healthRestore ? `Heals ${foodHealing(output.healthRestore, frontier.profile)} HP` : recipe.output === 'padded_vest' ? 'Armour · +3 max HP when equipped' : 'Tools & materials',
        owned: false, ...status,
        make: () => frontierAction({ action: 'craft', id: recipe.id }),
      };
    }) : []),
  ].sort((a, b) => Number(b.canCraft) - Number(a.canCraft));
  return <section className="game-panel crafting-panel" aria-label="Crafting">
    <header className="panel-heading">
      <h2>Craft <small>Level {craftingLevel}</small></h2>
      <button className="close-button" onClick={onClose} aria-label="Close crafting">×</button>
    </header>
    <p className="craft-instructions">Use items from your bag. Ingredients show held / needed.</p>
    {error && <p role="alert" className="craft-error">{error}</p>}
    <div className="recipe-list" aria-label={`Recipes · Crafting level ${craftingLevel}`}>
      {recipes.map(recipe => (
        <article className={`craft-recipe ${recipe.locked ? 'locked' : ''}`} key={recipe.id} data-recipe-row={recipe.id}>
          <div className="craft-recipe-heading">
            <img src={recipe.icon} alt="" />
            <div><h3>{recipe.name}{recipe.quantity > 1 && <small> ×{recipe.quantity}</small>}</h3><span>{recipe.description}</span></div>
            <button type="button" data-recipe={recipe.id} aria-label={`${recipe.owned ? 'Owned' : 'Make'} ${recipe.name}`}
              disabled={pending || !recipe.canCraft} aria-describedby={`recipe-requirement-${recipe.id}`}
              onClick={() => void run(recipe.make)}>
              {recipe.owned ? 'Owned' : pending ? '…' : 'Make'}
            </button>
          </div>
          <ul className="craft-ingredients" aria-label={`${recipe.name} ingredients`}>
            {recipe.inputs.map(input => (
              <li key={input.itemId} data-missing={input.have < input.quantity} aria-label={`${input.name}: ${input.have} held, ${input.quantity} needed`}>
                <img src={getItemDef(input.itemId)?.icon} alt="" /><span>{input.name}</span><strong>{input.have}/{input.quantity}</strong>
              </li>
            ))}
          </ul>
          <p className="craft-recipe-note" id={`recipe-requirement-${recipe.id}`}>{recipe.requirement}</p>
        </article>
      ))}
    </div>
  </section>;
});
export default CraftingPanel;
