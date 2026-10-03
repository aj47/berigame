import { useMemo } from 'react';
import { useFrontierObjects } from '../spacetime/hooks';
import type { Resource } from '../../../shared/sim/frontier/model';

/** Public reservations let nearby players see the same gathering action. */
export function useResourceHarvest(identity: string): Resource | undefined {
  const rows = useFrontierObjects();
  return useMemo(() => {
    for (const row of rows) {
      if (row.kind !== 'resource') continue;
      const resource = JSON.parse(row.data) as Resource;
      if (resource.harvest?.by === identity) return resource;
    }
  }, [rows, identity]);
}
