import { describe, expect, it } from 'vitest';
import { GARDEN_CENTER, GARDEN_PLOT_TILES } from '@sim';
import { minimapModel } from '../Components/minimapModel';
import { useGardenStore } from '../spacetime/stores/gardenStore';

describe('garden client helpers', () => {
  it('the minimap marks your garden and how many plots are ripe', () => {
    const m = minimapModel({ meHex: null, players: [], trees: [], groundItems: [], tick: 0, gardenRipe: 2 });
    expect(m.garden).toEqual({ x: GARDEN_CENTER.x - 0.5, z: GARDEN_CENTER.z - 0.5, ripe: 2 });
    expect(minimapModel({ meHex: null, players: [], trees: [], groundItems: [], tick: 0 }).garden?.ripe).toBe(0);
  });

  it('queues a garden action at the plot tile until you arrive', () => {
    const q = useGardenStore.getState().queue({ kind: 'plant', plot: 2, itemId: 'berry_greenberry' });
    expect(q.target).toEqual(GARDEN_PLOT_TILES[2]);
    expect(useGardenStore.getState().queued).toBe(q);
    useGardenStore.getState().clear();
    expect(useGardenStore.getState().queued).toBeNull();
  });
});
