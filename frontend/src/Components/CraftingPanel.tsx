import React, { memo, useMemo, useRef, useState } from 'react';
import { getItemDef, hasCosmetic, levelForXp, recipeStatus } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyCosmetics, useMySkills } from '../spacetime/hooks';
import { slotsFromRows } from './itemUi';
import './crafting.css';

const CraftingPanel = memo(({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const rows = useInventoryRows();
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
  const slots = useMemo(() => slotsFromRows(rows), [rows]);
  const craftingLevel = levelForXp(skills?.craftingXp ?? 0);
  const { craft } = useGameActions();
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
    } catch {
      setError('Could not craft. Try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (!open) return null;
  return <section className="game-panel crafting-panel" aria-label="Crafting">
    <header className="panel-heading">
      <h2>Craft <small>Level {craftingLevel}</small></h2>
      <button className="close-button" onClick={onClose} aria-label="Close crafting">×</button>
    </header>
    {error && <p role="alert" className="craft-error">{error}</p>}
    <div className="recipe-list" aria-label={`Recipes · Crafting level ${craftingLevel}`}>
      {recipeStatus(slots, craftingLevel).map((r) => {
        const owned = r.cosmetic !== null && hasCosmetic(cosmetics?.unlocked ?? 0, r.cosmetic);
        const icon = r.output ? getItemDef(r.output.itemId)?.icon : `/items/${r.id}.png`;
        const output = r.output ? getItemDef(r.output.itemId) : null;
        return (
          <article className={`craft-recipe ${r.locked ? "locked" : ""}`} key={r.id} data-recipe-row={r.id}>
            <div className="craft-recipe-heading">
              <img src={icon} alt="" />
              <div><h3>{r.name}</h3><span>{output?.weaponDamage ? `${output.weaponDamage} damage` : output?.healthRestore ? `Heals ${output.healthRestore} HP` : 'Keepsake'}</span></div>
            <button
              type="button"
              data-recipe={r.id}
              aria-label={`${owned ? 'Owned' : r.locked ? `Lv ${r.level}` : 'Make'} ${r.name}`}
              disabled={pending || !r.canCraft || owned}
              title={r.locked ? `Needs Crafting level ${r.level}` : undefined}
              onClick={() => void run(() => craft(r.id))}
            >
              {owned ? 'Owned' : r.locked ? `Lv ${r.level}` : pending ? '…' : 'Make'}
            </button>
            </div>
            <ul className="craft-ingredients" aria-label={`${r.name} ingredients`}>
              {r.inputs.map(i => {
                const have = slots.reduce((total, slot) => total + (slot?.itemId === i.itemId ? slot.quantity : 0), 0);
                return <li key={i.itemId} data-missing={have < i.quantity} aria-label={`${i.name}: ${have} held, ${i.quantity} needed`}>
                  <img src={getItemDef(i.itemId)?.icon} alt="" /><span>{i.name}</span><strong>{Math.min(have, i.quantity)}/{i.quantity}</strong>
                </li>;
              })}
            </ul>
            {r.locked ? <p className="craft-recipe-note">Unlocks at Crafting level {r.level}</p> : r.canCraft && !owned ? <p className="craft-recipe-note">+{r.xp} Crafting XP</p> : null}
          </article>
        );
      })}
    </div>
  </section>;
});
export default CraftingPanel;
