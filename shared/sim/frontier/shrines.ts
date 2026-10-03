import type { Cost, Location } from './catalog';
import type { Profile } from './model';

export type IslandShrine = Location & { id: string; name: string; description: string; cost: Cost; color: string };
export const ISLAND_SHRINES: readonly IslandShrine[] = [
  { id: 'reedwake', name: 'Reedwake Tide Shrine', region: 'reedwake', x: 8, z: 64,
    description: 'Mend the reed bindings and seal the weathered altar.', cost: { reeds: 8, resin: 4 }, color: '#7dbfa9' },
  { id: 'cinder', name: 'Cinder Ember Shrine', region: 'cinder', x: 8, z: 64,
    description: 'Rebuild the stone altar and restore its iron brazier.', cost: { stone: 8, iron_ore: 4 }, color: '#e49a62' },
];
export const shrineRestored = (p: Pick<Profile, 'events'>, id: string) => p.events[`shrine:${id}`] === 1;
export const shrineXpBonusPercent = (p: Pick<Profile, 'events'>) => ISLAND_SHRINES.filter(s => shrineRestored(p, s.id)).length * 5;

/** Integer hundredths retain small rewards; each discipline keeps its own permanent carry. */
export function awardDisciplineXp(p: Profile, discipline: number, amount: number) {
  const key = `shrine:xpCarry:${discipline}`;
  const bonus = amount * shrineXpBonusPercent(p) + (p.events[key] ?? 0);
  p.xp[discipline] = Math.min(21025, p.xp[discipline] + amount + Math.floor(bonus / 100));
  const carry = p.xp[discipline] >= 21025 ? 0 : bonus % 100;
  if (carry) p.events[key] = carry;
  else delete p.events[key];
}
