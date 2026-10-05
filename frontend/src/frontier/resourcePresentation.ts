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

export function resourceTitle(item: string) {
  return item === 'timber' ? 'Marked timber pine' : item.replace('berry_', '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
}

/** Shared by the hover hint and the live action dropdown, like the island's harvestStatus. */
export function resourceStatus(resource: Pick<Resource, 'item'> & Partial<Resource>, now: number, myId: string | null, harvesterName?: string) {
  const motion = gatheringMotion(resource.item);
  const berry = resource.item.startsWith('berry_');
  const verb = motion === 'chop' ? 'Chop' : motion === 'mine' ? 'Mine' : berry ? 'Harvest' : 'Gather';
  const regrowMs = resource.regrowsAt ? Math.max(0, resource.regrowsAt - now) : 0;
  let label = `${verb} ${motion === 'chop' ? 'timber pine' : resourceTitle(resource.item)}`;
  if (resource.harvest) {
    const activity = motion === 'chop' ? 'chopping' : motion === 'mine' ? 'mining' : berry ? 'harvesting' : 'gathering';
    label = resource.harvest.by === myId ? `You are ${activity}` : `${harvesterName ?? 'Someone'} is ${activity}`;
  } else if (regrowMs > 0) label = `Regrowing (${Math.ceil(regrowMs / 1000)}s)`;
  return { label, verb, busy: !!resource.harvest, regrowing: regrowMs > 0, unavailable: !!resource.harvest || regrowMs > 0 };
}

export function resourceHover(resource: Pick<Resource, 'item'> & Partial<Resource>, now: number, hasAxe = false) {
  const timber = resource.item === 'timber';
  const { verb, busy, regrowing, unavailable } = resourceStatus(resource, now, null);
  const detail = busy ? (timber ? 'Being chopped' : 'Being gathered')
    : regrowing ? 'Regrowing · try another tree'
    : timber ? hasAxe ? 'Axe · 2 timber' : 'Starter hatchet · 1 timber'
    : undefined;
  return {
    title: resourceTitle(resource.item), action: `Walk over for ${verb.toLowerCase()} options`, detail,
    tone: unavailable ? 'muted' as const : 'ready' as const, click: 'panel' as const,
  };
}
