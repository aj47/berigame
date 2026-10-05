import React, { memo, useMemo, useRef, useState } from 'react';
import { getItemDef, hasCosmetic, levelForXp, recipeStatus } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyCosmetics, useMySkills, useMyPlayer } from '../spacetime/hooks';
import { slotsFromRows } from './itemUi';
import './crafting.css';
import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import { CRAFT_CATEGORIES, craftCategory, frontierRecipeStatus, type CraftCategory } from './craftingModel';
import { foodHealing } from '../../../shared/sim/frontier/engine';

type CraftFilter = 'all' | 'ready' | CraftCategory;
/** Makeable first, then recipes that only need supplies, then level-locked ones. */
const rank = (recipe: { canCraft: boolean; locked: boolean }) => recipe.canCraft ? 0 : recipe.locked ? 2 : 1;

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
  const [filter, setFilter] = useState<CraftFilter>('all');
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
        category: craftCategory(recipe.output?.itemId ?? null),
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
      const category = craftCategory(recipe.output);
      return {
        id: recipe.id, name: output?.name ?? recipe.output, icon: output?.icon, category,
        description: output?.weaponDamage ? `${output.weaponDamage} damage` : output?.healthRestore ? `Heals ${foodHealing(output.healthRestore, frontier.profile)} HP` : recipe.output === 'padded_vest' ? 'Armour · +3 max HP when equipped' : category === 'tools' ? 'Tool' : category === 'food' ? 'Creature food' : 'Building material',
        owned: false, ...status,
        make: () => frontierAction({ action: 'craft', id: recipe.id }),
      };
    }) : []),
    // Stable within each rank, so cards only move when they become makeable.
  ].sort((a, b) => rank(a) - rank(b));
  const readyCount = recipes.filter(recipe => recipe.canCraft).length;
  const groups = CRAFT_CATEGORIES.map(category => ({ ...category, recipes: recipes.filter(recipe => recipe.category === category.id) }))
    .filter(group => group.recipes.length > 0);
  const active = filter === 'ready' || groups.some(group => group.id === filter) ? filter : 'all';
  const shown = active === 'all' ? groups
    : active === 'ready' ? [{ id: 'ready', label: 'Ready to make', recipes: recipes.filter(recipe => recipe.canCraft) }]
      : groups.filter(group => group.id === active);
  const chip = (id: CraftFilter, label: string, count: number) => (
    <button type="button" key={id} aria-pressed={active === id} onClick={() => setFilter(id)}
      aria-label={count ? `${label}, ${count} ready` : label}>
      {label}{count > 0 && <span className="craft-filter-count">{count}</span>}
    </button>
  );
  const card = (recipe: typeof recipes[number]) => (
    <article className={`craft-recipe ${recipe.locked ? 'locked' : ''}`} key={recipe.id} data-recipe-row={recipe.id} data-ready={recipe.canCraft}>
      <div className="craft-recipe-heading">
        <img src={recipe.icon} alt="" />
        <div><h4>{recipe.name}{recipe.quantity > 1 && <small> ×{recipe.quantity}</small>}</h4><span>{recipe.description}</span></div>
        <button type="button" data-recipe={recipe.id} aria-label={`${recipe.owned ? 'Owned' : 'Make'} ${recipe.name}`}
          disabled={pending || !recipe.canCraft} aria-describedby={`recipe-requirement-${recipe.id}`}
          onClick={() => void run(recipe.make)}>
          {recipe.owned ? 'Owned' : pending ? '…' : 'Make'}
        </button>
      </div>
      {!recipe.locked && <ul className="craft-ingredients" aria-label={`${recipe.name} ingredients`}>
        {recipe.inputs.map(input => (
          <li key={input.itemId} data-missing={input.have < input.quantity} aria-label={`${input.name}: ${input.have} held, ${input.quantity} needed`}>
            <img src={getItemDef(input.itemId)?.icon} alt="" /><span>{input.name}</span><strong>{input.have}/{input.quantity}</strong>
          </li>
        ))}
      </ul>}
      <p className="craft-recipe-note" id={`recipe-requirement-${recipe.id}`}>{recipe.requirement}</p>
    </article>
  );
  return <section className="game-panel crafting-panel" aria-label="Crafting">
    <header className="panel-heading">
      <h2>Craft <small>Level {craftingLevel}</small></h2>
      <button className="close-button" onClick={onClose} aria-label="Close crafting">×</button>
    </header>
    <div className="craft-filters" role="group" aria-label="Show recipes">
      {chip('all', 'All', 0)}
      {chip('ready', 'Ready', readyCount)}
      {groups.map(group => chip(group.id, group.label, group.recipes.filter(recipe => recipe.canCraft).length))}
    </div>
    {error && <p role="alert" className="craft-error">{error}</p>}
    <div className="recipe-list" aria-label={`Recipes · Crafting level ${craftingLevel}`}>
      {shown.map(group => (
        <div className="craft-group" role="group" key={group.id} aria-label={group.label}>
          {active === 'all' && <h3 className="craft-group-title">{group.label}</h3>}
          {group.recipes.map(card)}
        </div>
      ))}
      {active === 'ready' && readyCount === 0 && <p className="craft-empty">Nothing is ready yet. Check <button type="button" className="link-button" onClick={() => setFilter('all')}>All</button> to see what each recipe needs.</p>}
    </div>
  </section>;
});
export default CraftingPanel;
