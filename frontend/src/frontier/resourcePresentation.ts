import type { Resource } from '../../../shared/sim/frontier/model';

/** The same server timestamps drive the progress bar, fall, stump and new growth. */
export function resourcePresentation(resource: Partial<Resource> | undefined, now: number) {
  const harvest = resource?.harvest;
  const progress = harvest ? Math.max(0, Math.min(1, (now - harvest.startedAt) / (harvest.completesAt - harvest.startedAt))) : 0;
  const regrowing = !!resource?.regrowsAt && now < resource.regrowsAt;
  const age = resource?.felledAt ? Math.max(0, now - resource.felledAt) : Infinity;
  const falling = regrowing && age < 1100;
  const growth = regrowing ? Math.max(0, 1 - (resource!.regrowsAt! - now) / 2200) : 1;
  return { progress, regrowing, falling, fall: Math.min(1, age / 850), treeScale: falling ? 1 : growth, showStump: regrowing };
}

export function gatheringMotion(item: string): 'chop' | 'mine' | 'pluck' {
  return item === 'timber' ? 'chop' : ['stone', 'iron_ore', 'clay'].includes(item) ? 'mine' : 'pluck';
}

/** The public reservation supplies the tool for both the player and observers. */
export function gatheringTool(resource: Partial<Resource> | undefined): 'hatchet' | 'axe' | 'mine' | null {
  if (!resource?.item) return null;
  const motion = gatheringMotion(resource.item);
  return motion === 'chop' ? resource.harvest?.tool === 'axe' ? 'axe' : 'hatchet'
    : motion === 'mine' ? 'mine' : null;
}

export function resourceHover(resource: Pick<Resource, 'item'> & Partial<Resource>, now: number, hasAxe = false) {
  const timber = resource.item === 'timber';
  const title = timber ? 'Marked timber pine' : resource.item.replace('berry_', '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
  const action = resource.harvest ? (timber ? 'Being chopped' : 'Being gathered')
    : resource.regrowsAt && resource.regrowsAt > now ? 'Regrowing · try another tree'
    : timber ? hasAxe ? 'Chop · Axe · 2 timber' : 'Chop · Starter hatchet · 1 timber'
    : 'Walk over & gather';
  return { title, action, click: 'action' as const };
}
