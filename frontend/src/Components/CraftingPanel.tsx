import React, { memo, useMemo, useRef, useState } from 'react';
import { getCosmetic, getItemDef, hasCosmetic, levelForXp, recipeStatus } from '@sim';
import { useGameActions } from '../spacetime/actions';
import { useInventoryRows, useMyCosmetics, useMySkills } from '../spacetime/hooks';
import { slotsFromRows } from './itemUi';

const CraftingPanel = memo(({ open, onClose }: { open: boolean; onClose: () => void }) => {
  const rows = useInventoryRows();
  const skills = useMySkills();
  const cosmetics = useMyCosmetics();
  const slots = useMemo(() => slotsFromRows(rows), [rows]);
  const craftingLevel = levelForXp(skills?.craftingXp ?? 0);
  const { craft } = useGameActions();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  if (!open) return null;
  return <section className="game-panel crafting-panel" aria-label="Crafting">
    <header className="panel-heading">
      <div><span className="eyebrow">Crafting level {craftingLevel}</span><h2>Craft</h2></div>
      <button className="close-button" onClick={onClose} aria-label="Close crafting">×</button>
    </header>
    <div className="recipe-list" aria-label={`Recipes · Crafting level ${craftingLevel}`}>
      {recipeStatus(slots, craftingLevel).map((r) => {
        const owned = r.cosmetic !== null && hasCosmetic(cosmetics?.unlocked ?? 0, r.cosmetic);
        const icon = r.output ? getItemDef(r.output.itemId)?.icon : `/items/${r.id}.png`;
        return (
          <div className={`recipe-row ${r.locked ? "locked" : ""}`} key={r.id} data-recipe-row={r.id}>
            <button
              type="button"
              data-recipe={r.id}
              disabled={pending || !r.canCraft || owned}
              title={r.locked ? `Needs Crafting level ${r.level}` : undefined}
              onClick={() => void run(() => craft(r.id))}
            >
              <img src={icon} alt="" /> {r.locked ? `Lv ${r.level}` : "Make"} {r.name}
            </button>
            <span className="fine-print">
              {r.inputs.map((i) => `${i.quantity} ${i.name}`).join(" + ")}
              {r.output && getItemDef(r.output.itemId)?.weaponDamage ? ` → ${getItemDef(r.output.itemId)!.weaponDamage} damage` : ""}
              {r.output && getItemDef(r.output.itemId)?.healthRestore ? ` → heals ${getItemDef(r.output.itemId)!.healthRestore}` : ""}
              {r.cosmetic !== null ? ` → ${getCosmetic(r.cosmetic)?.name} (keepsake)` : ""}
              {r.locked ? ` — needs Crafting level ${r.level}` : owned ? " — already yours" : r.canCraft ? ` · +${r.xp} Crafting XP` : ""}
            </span>
          </div>
        );
      })}
    </div>
  </section>;
});
export default CraftingPanel;
