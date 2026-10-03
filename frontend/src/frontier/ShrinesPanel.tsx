import React from 'react';
import { getItemDef } from '@sim';
import { REGIONS, type Location } from '../../../shared/sim/frontier/catalog';
import type { Profile } from '../../../shared/sim/frontier/model';
import type { Command } from '../../../shared/sim/frontier/engine';
import { near } from '../../../shared/sim/frontier/regions';
import { ISLAND_SHRINES, shrineRestored, shrineXpBonusPercent } from '../../../shared/sim/frontier/shrines';

export default function ShrinesPanel({ profile, me, bag, busy, aboard, onAction }: {
  profile: Profile; me: Location; bag: readonly { itemId: string; quantity: number }[];
  busy: boolean; aboard: boolean; onAction: (command: Command) => unknown;
}) {
  return <section aria-label="Island shrines">
    <h3>Island shrines</h3>
    <p className="frontier-active">Your permanent bonus: +{shrineXpBonusPercent(profile)}% discipline XP</p>
    <details><summary>About shrine blessings</summary><p>Restore each shrine once for permanent +5% XP in all five disciplines, up to +10% total. The blessing stays through death, travel and land capture. Small XP bonuses add up; the discipline XP cap stays the same.</p></details>
    {ISLAND_SHRINES.map(shrine => {
      const restored = shrineRestored(profile, shrine.id);
      const sameIsland = me.region === shrine.region, close = near(me, shrine, 2) && !aboard;
      const costs = Object.entries(shrine.cost).map(([item, needed]) => ({ item, needed, held: bag.reduce((total, row) => total + (row.itemId === item ? row.quantity : 0), 0) }));
      const enough = costs.every(cost => cost.held >= cost.needed);
      return <article key={shrine.id}>
        <h4>{shrine.name}</h4>
        <p>{REGIONS[shrine.region].name} · near the landing at {shrine.x},{shrine.z}</p>
        {restored ? <p className="frontier-active">Restored · permanent +5% discipline XP</p> : <>
          <p>{shrine.description}</p>
          <div className="frontier-materials">{costs.map(({ item, needed, held }) => <small key={item} data-enough={held >= needed}>{getItemDef(item)?.name ?? item} · {held}/{needed}</small>)}</div>
          {!sameIsland ? <p className="frontier-hint">Sail to {REGIONS[shrine.region].name}, dock and disembark to visit.</p>
            : aboard ? <p className="frontier-hint">Disembark to visit the shrine.</p>
            : !close ? <button disabled={busy} onClick={() => onAction({ action: 'move', x: shrine.x, z: shrine.z })}>Walk to {shrine.name}</button> : null}
          <button disabled={busy || !close || !enough} onClick={() => onAction({ action: 'restore_shrine', id: shrine.id })}>Restore {shrine.name} · +5% XP</button>
        </>}
      </article>;
    })}
  </section>;
}
