import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GIANT_FEAST } from '@sim';
import AdventureWorld from '../Components/3D/AdventureWorld';
import { useUserInputStore } from '../store';

const mock = vi.hoisted(() => ({ expeditions: [] as any[], tick: 100 }));
vi.mock('../spacetime/hooks', () => ({
  useExpeditions: () => mock.expeditions, useIslandProjects: () => [], usePlayers: () => [], useTick: () => mock.tick,
}));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));
vi.mock('../Components/3D/AdventureModels', () => ({
  AdventureAssetView: () => null,
  AdventureActor: ({ asset, x, z, label, speech, mood, onInteract, hoverAction }: any) => asset === 'berry-giant'
    ? <button data-x={x} data-z={z} data-mood={mood} aria-label={hoverAction} onClick={() => onInteract({ clientX: 10, clientY: 20 })}>{label} {speech}</button>
    : null,
}));

const expedition = (patch = {}) => ({ id: 7n, stage: 'hauling', destination: 'feast', x: 34, z: 17, giantX: 36, giantZ: 29, giantUntil: 0, baitUntil: 0, hiddenUntil: 0, untilTick: 200, ...patch });
beforeEach(() => { mock.expeditions = []; mock.tick = 100; useUserInputStore.getState().setClickedOtherObject(null); });
afterEach(cleanup);

describe('Berry Giant world presence', () => {
  it('welcomes players at the feast before they start an expedition', () => {
    render(<AdventureWorld />);
    const giant = screen.getByRole('button', { name: 'Feed a giant berry' });
    expect(giant).toHaveTextContent('Bring me a giant berry!');
    expect(giant).toHaveAttribute('data-x', String(GIANT_FEAST.x));
    expect(giant).toHaveAttribute('data-z', String(GIANT_FEAST.z - 2.5));
    fireEvent.click(giant);
    expect(useUserInputStore.getState().clickedOtherObject).toMatchObject({ berryGiantExpeditionId: 0n });
  });

  it('uses each hauling Giant’s live position and expedition', () => {
    mock.expeditions = [expedition(), expedition({ id: 8n, giantX: 22, giantZ: 30 })];
    render(<AdventureWorld />);
    const giants = screen.getAllByRole('button', { name: 'Feed a giant berry' });
    expect(giants).toHaveLength(2);
    expect(giants[1]).toHaveAttribute('data-x', '22');
    expect(giants[1]).toHaveAttribute('data-z', '30');
    expect(screen.queryByText(/Bring me a giant berry/)).not.toBeInTheDocument();
    fireEvent.click(giants[1]);
    expect(useUserInputStore.getState().clickedOtherObject).toMatchObject({ berryGiantExpeditionId: 8n });
  });

  it('keeps a fed Giant celebrating at the feast until its result expires', () => {
    mock.expeditions = [expedition({ stage: 'complete' })];
    const { rerender } = render(<AdventureWorld />);
    const giant = screen.getByRole('button', { name: 'Meet your berry friend' });
    expect(giant).toHaveAttribute('data-mood', 'happy');
    expect(giant).toHaveAttribute('data-x', String(GIANT_FEAST.x));
    expect(giant).toHaveAttribute('data-z', String(GIANT_FEAST.z - 2.5));
    expect(giant).toHaveTextContent('Thank you, berry friend!');
    fireEvent.click(giant);
    expect(useUserInputStore.getState().clickedOtherObject).toMatchObject({ berryGiantExpeditionId: 7n });
    mock.tick = 201; rerender(<AdventureWorld />);
    expect(screen.queryByRole('button', { name: 'Meet your berry friend' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Feed a giant berry' })).toHaveTextContent('Bring me a giant berry!');
  });

  it('does not celebrate lost berries or deliveries to the market', () => {
    mock.expeditions = [expedition({ stage: 'lost' }), expedition({ id: 8n, stage: 'complete', destination: 'market' })];
    render(<AdventureWorld />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveTextContent('Bring me a giant berry!');
  });
});
