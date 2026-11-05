import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BIOMES, EXPANSE_LANDMARKS } from '../../../shared/sim/expanse';
import IslandMap, * as atlas from '../site/IslandMap';

afterEach(cleanup);
describe('site atlas', () => {
  it('samples the terrain on first render, not at import, and only once', () => {
    expect(atlas.islandMapSamples).toBe(0);
    const ui = render(<IslandMap selected="grove" onSelect={() => {}} />);
    ui.rerender(<IslandMap selected="coast" onSelect={() => {}} />);
    render(<IslandMap selected="boulders" onSelect={() => {}} />);
    expect(atlas.islandMapSamples).toBe(1);
  });
  it('shows the whole Expanse: every biome filled and named, mainland places, waystones and routes', () => {
    const { container } = render(<IslandMap selected="grove" onSelect={() => {}} />);
    const { biomeAreas, landPath, regionPaths } = atlas.islandMapGeometry();
    for (const id of ['frostpine', 'hearthvale', 'glimmerfen', 'dunes', 'starfall'] as const) {
      const area = biomeAreas.find(b => b.id === id)!;
      expect(area.path.length).toBeGreaterThan(100);
      expect(container.querySelector(`.island-map__biome--${id}`)).not.toBeNull();
      expect(container.textContent).toContain(BIOMES[id].name.toUpperCase());
    }
    expect(landPath.length).toBeGreaterThan(1000);
    for (const region of ['grove', 'coast', 'boulders'] as const) expect(regionPaths[region]).toMatch(/^M/);
    for (const place of EXPANSE_LANDMARKS) expect(container.querySelector(`.island-map__landmark--${place.id}`)).not.toBeNull();
    expect(container.querySelectorAll('.island-map__waystone').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.island-map__causeway').length).toBeGreaterThan(0);
  });
  it('keeps the three island regions selectable', () => {
    const onSelect = vi.fn();
    render(<IslandMap selected="grove" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Explore the Boulders' }));
    expect(onSelect).toHaveBeenCalledWith('boulders');
  });
});
