import { levelForXp } from '@sim';
import { DISCIPLINES, type Cost, type Point } from '../../../shared/sim/frontier/catalog';
import { homePoint, isHomeRegion } from '../../../shared/sim/frontier/homeMap';
import type { FrontierSnapshot } from '../../../shared/sim/frontier/snapshot';

type Plot = FrontierSnapshot['plots'][number];
export const plotName = (plot: Pick<Plot, 'id' | 'region'>) =>
  `${plot.region === 'settlement' ? 'Meadow' : plot.region === 'reedwake' ? 'Reedwake' : 'Cinder'} plot ${plot.id.split('-').pop()}`;

export function defaultPlot(plots: Plot[], player: Point & { region: string }, owner: string, selected: string) {
  const explicit = plots.find(p => p.id === selected);
  if (explicit) return explicit;
  const owned = plots.find(p => p.claim?.owner === owner);
  if (owned) return owned;
  const region = isHomeRegion(player.region) ? 'settlement' : player.region;
  const point = homePoint(player, player.region);
  const distance = (plot: Plot) => {
    const marker = homePoint(plot.marker, plot.region);
    return Math.hypot(marker.x - point.x, marker.z - point.z);
  };
  const nearby = plots.filter(p => p.region === region);
  return (nearby.filter(p => !p.claim).length ? nearby.filter(p => !p.claim) : nearby)
    .sort((a, b) => distance(a) - distance(b))[0];
}

export function unlockHint(profile: FrontierSnapshot['profile'], item: { discipline?: number; level?: number }) {
  if (item.discipline === undefined) return '';
  const name = DISCIPLINES[item.discipline], level = item.level ?? 1;
  return !profile.active.includes(item.discipline) || levelForXp(profile.xp[item.discipline]) < level
    ? `Requires ${name} level ${level} as an active discipline.` : '';
}

export function missingMaterials(items: Cost, bag: { itemId: string; quantity: number }[]) {
  return Object.fromEntries(Object.entries(items).flatMap(([item, amount]) => {
    const missing = amount - bag.reduce((n, row) => n + (row.itemId === item ? row.quantity : 0), 0);
    return missing > 0 ? [[item, missing]] : [];
  }));
}

/** A named date avoids day/month ambiguity; a rounded countdown keeps it scannable. */
export function deadlineLabel(timestamp: number, now: number) {
  const date = new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const minutes = Math.ceil(Math.abs(timestamp - now) / 60_000);
  const unit = minutes >= 1440 ? 'day' : minutes >= 60 ? 'hour' : 'minute';
  const count = Math.max(1, Math.ceil(minutes / (unit === 'day' ? 1440 : unit === 'hour' ? 60 : 1)));
  const duration = `${count} ${unit}${count === 1 ? '' : 's'}`;
  return `${date} · ${timestamp > now ? `${duration} left` : `${duration} overdue`}`;
}
