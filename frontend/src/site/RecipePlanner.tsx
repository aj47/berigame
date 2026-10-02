import { wikiUrl } from './siteUrls';
import { useId, useState } from 'react';
import { ITEM_DEFS, RECIPES, SKILL_MAX_LEVEL } from '@sim';
import { MAX_PLAN_QUANTITY, parseRecipeQuantity, planRecipe, recipeQuantityLimit } from './recipePlannerData';
import './recipePlanner.css';

const number = (value: number) => value.toLocaleString('en-US');
const recipeIcon = (recipe: typeof RECIPES[number]) => recipe.output ? ITEM_DEFS[recipe.output.itemId].icon : '/items/driftwood_crown.png';

export default function RecipePlanner() {
  const [recipeId, setRecipeId] = useState(RECIPES[0].id);
  const [quantity, setQuantity] = useState('1');
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const recipe = RECIPES.find(entry => entry.id === recipeId)!;
  const limit = recipeQuantityLimit(recipe);
  const parsed = parseRecipeQuantity(quantity, limit);
  const plan = planRecipe(recipe, quantity);
  const single = recipe.cosmetic !== undefined;
  const unitPlan = planRecipe(recipe, '1')!;
  const invalid = parsed === null;

  const step = (amount: number) => {
    const current = Number(quantity);
    const next = Number.isFinite(current) ? Math.trunc(current) + amount : 1;
    setQuantity(String(Math.max(1, Math.min(limit, next))));
  };

  return <div className="recipe-planner">
    <header className="recipe-planner-heading">
      <div><span className="recipe-planner-eyebrow">A little preparation goes a long way</span><h2 id="wiki-heading-recipe-planner" tabIndex={-1}>Plan your supplies</h2></div>
      <span className="recipe-planner-badge">{RECIPES.length} recipes</span>
    </header>
    <p className="recipe-planner-intro">Choose what to make. See exactly what to gather.</p>

    <div className="recipe-planner-options" role="group" aria-label="Choose a recipe">
      {RECIPES.map(entry => <button type="button" key={entry.id} aria-pressed={entry.id === recipeId} onClick={() => {
        setRecipeId(entry.id);
        if (recipeQuantityLimit(entry) === 1) setQuantity('1');
      }}>
        <img src={recipeIcon(entry)} alt="" width="48" height="48" loading="lazy" />
        <span>{entry.name}</span><small>Level {entry.level}</small>
      </button>)}
    </div>

    <div className="recipe-planner-settings">
      <div className="recipe-planner-quantity">
        <label htmlFor={inputId}>Number of crafts</label>
        <div className="recipe-planner-stepper">
          <button type="button" aria-label="Decrease craft quantity" disabled={single || parsed === 1} onClick={() => step(-1)}>−</button>
          <input id={inputId} type="number" inputMode="numeric" min={1} max={limit} step={1} value={quantity} disabled={single} aria-invalid={invalid || undefined} aria-describedby={hintId} onChange={event => setQuantity(event.target.value)} onBlur={() => { if (quantity.trim() === '') setQuantity('1'); }} />
          <button type="button" aria-label="Increase craft quantity" disabled={single || parsed === limit} onClick={() => step(1)}>+</button>
        </div>
      </div>
      <div className="recipe-planner-level"><span>Crafting required</span><strong>Level {recipe.level}</strong><a href={wikiUrl('skills-progression#xp-table')}>{number(unitPlan.requiredXp)} total XP</a></div>
    </div>
    <p id={hintId} className={`recipe-planner-hint${invalid ? ' recipe-planner-invalid' : ''}`}>
      {single ? 'A permanent keepsake. Each character can craft it once.' : invalid ? `Enter a whole number from 1 to ${MAX_PLAN_QUANTITY}.` : 'Use + and −, or type a quantity to update your plan.'}
    </p>

    <div className="recipe-planner-ingredients">
      <h3>You’ll need</h3>
      <ul>{unitPlan.ingredients.map((ingredient, index) => <li key={ingredient.itemId}>
        <a href={ingredient.href}><img src={ingredient.icon} alt="" width="38" height="38" loading="lazy" /><span>{ingredient.name}</span></a>
        <span className="recipe-planner-amount"><span aria-hidden="true">× </span>{plan ? number(plan.ingredients[index].quantity) : '—'}</span>
      </li>)}</ul>
    </div>

    <div className="recipe-planner-result">
      <div className="recipe-planner-output"><img src={recipeIcon(recipe)} alt="" width="45" height="45" loading="lazy" /><div><span>{single ? 'You’ll unlock' : 'You’ll make'}</span><a href={unitPlan.outputHref}>{single ? recipe.name : <>{plan ? number(plan.outputQuantity) : '—'} × {recipe.name}</>}</a></div></div>
      <div className="recipe-planner-xp"><span>Crafting XP</span><strong>{plan ? `+${number(plan.xp)}` : '—'}</strong></div>
    </div>
    <p className="recipe-planner-footnote">XP shown before the level {SKILL_MAX_LEVEL} cap. Gather the supplies, then make each craft from your bag.</p>
    <span className="recipe-planner-sr" role="status" aria-live="polite">{plan ? `${plan.quantity} ${plan.quantity === 1 ? 'craft' : 'crafts'}: ${plan.ingredients.map(ingredient => `${ingredient.quantity} ${ingredient.name}`).join(' and ')}. ${single ? `Unlock ${recipe.name}` : `Make ${plan.outputQuantity} ${recipe.name}`}. ${plan.xp} Crafting XP before the level cap.` : 'Enter a valid quantity to calculate ingredients and experience.'}</span>
  </div>;
}
