import { describe, expect, it } from 'vitest';
import { PLOTS } from '../../../shared/sim/frontier/catalog';
import { meadowTrailDistance } from '../frontier/meadowPathArt';

describe('Meadows trail art', () => {
  it('keeps the harbour connection, main lane and existing parcel approaches visible', () => {
    for (let x = 0; x <= 31; x++) expect(meadowTrailDistance(x,64)).toBe(0);
    for (let z = 9; z <= 112; z++) expect(meadowTrailDistance(31,z)).toBe(0);
    for (const plot of PLOTS.filter(p=>p.region==='settlement')) {
      // The one town row already bends from z64 to z63 beside the steward.
      const z = plot.z === 65 && plot.marker.x < 31 ? 64 : plot.z - 2;
      expect(meadowTrailDistance(plot.marker.x,z)).toBeLessThan(.45);
      expect(meadowTrailDistance(plot.x+7,z)).toBeLessThan(.45);
    }
  });

  it('varies secondary edges and fades their unused ends without moving the centerline', () => {
    const edges = [40,48,56,64,72,80,88].map(x=>meadowTrailDistance(x,25.7));
    expect(Math.max(...edges)-Math.min(...edges)).toBeGreaterThan(.1);
    for (const x of [15,40,60,85]) expect(meadowTrailDistance(x,25)).toBeLessThan(meadowTrailDistance(x,26));
    expect(meadowTrailDistance(2,25)).toBeGreaterThan(1.1);
    expect(meadowTrailDistance(104,25)).toBeGreaterThan(1.1);
    expect(meadowTrailDistance(96,25)).toBeLessThan(meadowTrailDistance(100,25));
  });
});
