import { getItemDef, levelForXp, type Slot } from '@sim';
import { PIECES, PORTS, REGIONS, type Recipe } from '../../../shared/sim/frontier/catalog';
import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';
import { unlockHint } from '../frontier/panelModel';

type Crafter = { x: number; z: number; region?: string; hostile?: boolean; identity: { toHexString(): string } };

export function frontierRecipeStatus(recipe: Recipe, state: FrontierSnapshot, player: Crafter | null, slots: readonly Slot[], now = Date.now()) {
  const buildingActive = state.profile.active.includes(2);
  const buildingLevel = levelForXp(state.profile.xp[2]);
  const inputs = Object.entries(recipe.inputs).map(([itemId, amount]) => ({
    itemId,
    name: getItemDef(itemId)?.name ?? itemId,
    quantity: buildingActive && buildingLevel >= 10 && amount >= 4 ? amount - 1 : amount,
    have: slots.reduce((total, slot) => total + (slot?.itemId === itemId ? slot.quantity : 0), 0),
  }));
  const region = player?.region || 'bramblewild';
  const nearby = (point: { x: number; z: number }, range: number) => !!player && Math.max(Math.abs(player.x - point.x), Math.abs(player.z - point.z)) <= range;
  const stationName = recipe.station === 'harbour' ? 'Harbour' : Object.values(PIECES).find(piece => piece.station === recipe.station)?.name ?? recipe.station;
  const atStation = !recipe.station || (recipe.station === 'harbour'
    ? PORTS.some(port => port.region === region && nearby(port, 4))
    : (region === 'settlement' && nearby(REGIONS.settlement.spawn, 4)) || state.buildings.some(building => {
      if (building.region !== region || PIECES[building.piece]?.station !== recipe.station || !nearby(building, 2)) return false;
      const claim = state.plots.find(plot => plot.id === building.claim)?.claim;
      const id = player?.identity.toHexString() ?? '';
      return !!claim && (claim.owner === id || !!((claim.permissions[id] ?? 0) & 1));
    }));
  const stationHint = !recipe.station ? 'Make anywhere.' : atStation ? `${stationName} ready.`
    : recipe.station === 'harbour' ? 'Needs a harbour. Walk beside a dock.'
      : `Needs ${stationName?.toLowerCase()}. Visit the Meadows town workshop or an accessible station.`;
  const unlock = unlockHint(state.profile, recipe);
  const combat = !!player?.hostile || (state.profile.events.hostileUntil ?? 0) > now;
  return {
    inputs,
    quantity: recipe.quantity + (buildingActive && buildingLevel >= 2 && recipe.quantity >= 2 ? 1 : 0),
    requirement: [unlock, stationHint, combat ? 'Finish combat before crafting.' : ''].filter(Boolean).join(' '),
    canCraft: !!player && !unlock && atStation && !combat && inputs.every(input => input.have >= input.quantity),
    locked: !!unlock,
  };
}
