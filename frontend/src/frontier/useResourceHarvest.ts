import { useCallback } from 'react';
import { useFrontierObjectsSelector } from '../spacetime/hooks';
import type { FrontierObject } from '../module_bindings/types';
import type { Resource } from '../../../shared/sim/frontier/model';

const parsed = new WeakMap<FrontierObject, Resource>();
const reservations = new WeakMap<readonly FrontierObject[], Map<string, Resource>>();
function harvestsByPlayer(rows: readonly FrontierObject[]): Map<string, Resource> {
  let byPlayer = reservations.get(rows);
  if (byPlayer) return byPlayer;
  byPlayer = new Map();
  for (const row of rows) {
    if (row.kind !== 'resource') continue;
    let resource = parsed.get(row);
    if (!resource) { resource = JSON.parse(row.data) as Resource; parsed.set(row, resource); }
    if (resource.harvest && !byPlayer.has(resource.harvest.by)) byPlayer.set(resource.harvest.by, resource);
  }
  reservations.set(rows, byPlayer);
  return byPlayer;
}

/** Public reservations let nearby players see the same gathering action. */
export function useResourceHarvest(identity: string): Resource | undefined {
  return useFrontierObjectsSelector(useCallback(rows => harvestsByPlayer(rows).get(identity), [identity]));
}
