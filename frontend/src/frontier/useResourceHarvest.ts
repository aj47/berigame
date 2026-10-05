import { useCallback, useMemo } from 'react';
import { useFrontierObjectsSelector } from '../spacetime/hooks';
import type { FrontierObject } from '../module_bindings/types';
import type { Resource } from '../../../shared/sim/frontier/model';
import { RESOURCE_PATCHES } from '../../../shared/sim/frontier/catalog';

const parsed = new WeakMap<FrontierObject, Resource>();
function parse(row: FrontierObject): Resource {
  let resource = parsed.get(row);
  if (!resource) { resource = JSON.parse(row.data) as Resource; parsed.set(row, resource); }
  return resource;
}
const reservations = new WeakMap<readonly FrontierObject[], Map<string, Resource>>();
function harvestsByPlayer(rows: readonly FrontierObject[]): Map<string, Resource> {
  let byPlayer = reservations.get(rows);
  if (byPlayer) return byPlayer;
  byPlayer = new Map();
  for (const row of rows) {
    if (row.kind !== 'resource') continue;
    const resource = parse(row);
    if (resource.harvest && !byPlayer.has(resource.harvest.by)) byPlayer.set(resource.harvest.by, resource);
  }
  reservations.set(rows, byPlayer);
  return byPlayer;
}

/** One patch's live state, merged over its catalog entry as the frontier snapshot does. */
export function useResource(id: string): Resource | undefined {
  const row = useFrontierObjectsSelector(useCallback(rows => {
    for (const r of rows) if (r.kind === 'resource' && parse(r).id === id) return parse(r);
    return undefined;
  }, [id]));
  const node = RESOURCE_PATCHES.find(n => n.id === id);
  return useMemo(() => node && { ...node, ...row } as Resource, [node, row]);
}

/** Public reservations let nearby players see the same gathering action. */
export function useResourceHarvest(identity: string): Resource | undefined {
  return useFrontierObjectsSelector(useCallback(rows => harvestsByPlayer(rows).get(identity), [identity]));
}
