import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClickDropdown from '../Components/ClickDropdown';
import AdventureWorld from '../Components/3D/AdventureWorld';
import { useUserInputStore } from '../store';

const mock = vi.hoisted(() => ({
  tick: 100, me: null as any, expeditions: [] as any[], members: [] as any[],
  profiles: [] as any[], inventory: [] as any[], players: [] as any[],
  action: vi.fn().mockResolvedValue(true), walk: vi.fn().mockResolvedValue(true), openAdventure: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useExpeditions: () => mock.expeditions, useExpeditionMembers: () => mock.members,
  useAdventureProfiles: () => mock.profiles, useInventoryRows: () => mock.inventory, usePlayers: () => mock.players,
  useFriendlyDuels: () => [], useIslandProjects: () => [], useTick: () => mock.tick,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ expeditionAction: mock.action, setTarget: mock.walk }) }));
vi.mock('../Components/adventureNavigation', () => ({ openAdventure: mock.openAdventure }));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {} }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));
vi.mock('../Components/3D/AdventureModels', () => ({
  AdventureAssetView: () => null,
  AdventureActor: ({ asset, onInteract }: any) => asset === 'berry-giant' ? <button onClick={() => onInteract({ clientX: 200, clientY: 150 })}>Giant model</button> : null,
}));
const identity = (id: string) => ({ toHexString: () => id });
function select(id = 7n) {
  useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Berry Giant', berryGiantExpeditionId: id });
  return render(<ClickDropdown />);
}
beforeEach(() => {
  mock.tick = 100;
  mock.me = { identity: identity('me'), x: 22, z: 18, state: 0, hostile: false };
  mock.expeditions = [{ id: 7n, stage: 'hauling', x: 34, z: 17, giantX: 36, giantZ: 29, giantUntil: 110, baitUntil: 0, hiddenUntil: 0 }];
  mock.members = [{ identity: mock.me.identity, expeditionId: 7n, cooldown: 0 }];
  mock.profiles = []; mock.inventory = [{ itemId: 'berry_greenberry', quantity: 1 }]; mock.players = [];
  mock.action.mockReset().mockResolvedValue(true); mock.walk.mockReset().mockResolvedValue(true); mock.openAdventure.mockClear();
  useUserInputStore.getState().setClickedOtherObject(null);
});
afterEach(cleanup);

describe('Berry Giant interaction', () => {
  it('clicks the second Giant into its own interaction without opening Adventure', () => {
    mock.expeditions.push({ ...mock.expeditions[0], id: 8n });
    render(<AdventureWorld />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Giant model' })[1]);
    expect(useUserInputStore.getState().clickedOtherObject).toMatchObject({ connectionId: 'Berry Giant', berryGiantExpeditionId: 8n });
    expect(mock.openAdventure).not.toHaveBeenCalled();
  });

  it('uses live countdowns and changes from resting to following bait to hungry', () => {
    const { rerender } = select();
    expect(screen.getByText('resting · 6s')).toBeInTheDocument();
    mock.tick = 105; rerender(<ClickDropdown />);
    expect(screen.getByText('resting · 3s')).toBeInTheDocument();
    mock.tick = 110; mock.expeditions[0].baitUntil = 125; rerender(<ClickDropdown />);
    expect(screen.getByText('following bait · 9s')).toBeInTheDocument();
    mock.tick = 125; rerender(<ClickDropdown />);
    expect(screen.getByText('following the berry')).toBeInTheDocument();
    expect(screen.getByText(/Sniff… big berry/)).toBeInTheDocument();
  });

  it('drops bait for the selected expedition and stays open for the live response', async () => {
    select();
    fireEvent.click(screen.getByRole('button', { name: 'Drop bait here · 1 greenberry' }));
    await waitFor(() => expect(mock.action).toHaveBeenCalledExactlyOnceWith('bait', 7n));
    expect(screen.getByRole('group', { name: 'Actions for Berry Giant' })).toBeInTheDocument();
  });

  it('guards missing bait, equipped decoys, cooldown, and carrying without sending invalid actions', async () => {
    mock.inventory = [];
    const { rerender } = select();
    expect(screen.getByRole('button', { name: /Drop bait/ })).toBeDisabled();
    mock.profiles = [{ identity: mock.me.identity, loadout: 1 << 4 }];
    mock.inventory = [{ itemId: 'driftwood', quantity: 1 }];
    mock.members[0].cooldown = 105;
    rerender(<ClickDropdown />);
    expect(screen.getByRole('button', { name: 'Drop bait here · 1 driftwood' })).toBeDisabled();
    expect(screen.getByText('Catch your breath · 3s')).toBeInTheDocument();
    mock.tick = 105; rerender(<ClickDropdown />);
    expect(screen.getByRole('button', { name: /Drop bait/ })).toBeEnabled();
    mock.expeditions[0].carrier = mock.me.identity; rerender(<ClickDropdown />);
    expect(screen.queryByRole('button', { name: /Drop bait/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Put the berry down' }));
    await waitFor(() => expect(mock.action).toHaveBeenCalledExactlyOnceWith('put_down', 7n));
  });

  it('never spends bait on another team’s Giant and allows an available player to join from camp', async () => {
    mock.expeditions.push({ ...mock.expeditions[0], id: 8n });
    const { rerender } = select(8n);
    expect(screen.getByText(/helping a different delivery/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drop bait/ })).not.toBeInTheDocument();
    mock.members = []; rerender(<ClickDropdown />);
    fireEvent.click(screen.getByRole('button', { name: 'Help with this delivery' }));
    await waitFor(() => expect(mock.action).toHaveBeenCalledExactlyOnceWith('join', 8n));
  });

  it('takes a distant newcomer to the live carrier’s position', async () => {
    mock.members = []; mock.me.x = 12; mock.me.z = 35;
    mock.expeditions[0].carrier = identity('carrier');
    mock.players = [{ identity: identity('carrier'), x: 29, z: 31 }];
    select();
    fireEvent.click(screen.getByRole('button', { name: 'Go to the giant berry' }));
    await waitFor(() => expect(mock.walk).toHaveBeenCalledExactlyOnceWith(29, 31));
    expect(mock.action).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('group')).not.toBeInTheDocument());
  });

  it('removes actions when its expedition ends and can be dismissed with Escape', () => {
    const { rerender } = select();
    mock.expeditions[0].stage = 'complete'; rerender(<ClickDropdown />);
    expect(screen.getByText(/adventure has ended/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Drop bait/ })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('does not submit a second bait action while the first is in flight', async () => {
    let finish!: (value: boolean) => void;
    mock.action.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    select();
    const button = screen.getByRole('button', { name: /Drop bait/ });
    fireEvent.click(button); fireEvent.click(button);
    expect(mock.action).toHaveBeenCalledOnce();
    await act(async () => finish(false));
    expect(button).toBeEnabled();
  });

  it('explains the idle Giant’s gifts and opens feast planning without spending anything', () => {
    mock.expeditions = []; mock.members = [];
    select(0n);
    expect(screen.getByText('Berry Heart keepsake')).toBeVisible();
    expect(screen.getByText('+2 bonus goldberries')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Plan a feast/ }));
    expect(mock.openAdventure).toHaveBeenCalledWith('feast');
    expect(mock.action).not.toHaveBeenCalled();
  });

  it('keeps a growing adventure active when visiting the idle Giant', () => {
    mock.expeditions[0].stage = 'growing';
    select(0n);
    expect(screen.getByText(/Your berry is growing/)).toBeVisible();
    expect(screen.queryByText(/adventure has ended/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue my berry adventure/ }));
    expect(mock.openAdventure).toHaveBeenCalledWith('expedition');
    expect(mock.action).not.toHaveBeenCalled();
  });

  it('feeds the selected Giant only when the player and cargo reach the clearing', async () => {
    Object.assign(mock.me, { x: 12, z: 36 });
    Object.assign(mock.expeditions[0], { x: 12, z: 36, carrier: mock.me.identity, value: 4 });
    select();
    expect(screen.getByText('6 goldberries')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Share the feast/ }));
    await waitFor(() => expect(mock.action).toHaveBeenCalledExactlyOnceWith('feed', 7n));
  });

  it('offers a route to the clearing while carrying, without feeding early', async () => {
    mock.expeditions[0].carrier = mock.me.identity;
    select();
    expect(screen.queryByRole('button', { name: /Share the feast/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bring berry to feast/ }));
    await waitFor(() => expect(mock.walk).toHaveBeenCalledExactlyOnceWith(12, 36));
    expect(mock.action).not.toHaveBeenCalled();
  });

  it('shows earned rewards and friendship after feeding, but does not award spectators', () => {
    Object.assign(mock.expeditions[0], { stage: 'complete', destination: 'feast', value: 4 });
    mock.members[0].contributions = 1;
    mock.profiles = [{ identity: mock.me.identity, giantTrust: 1 }];
    const { rerender } = select();
    expect(screen.getByLabelText('Feast rewards earned')).toHaveTextContent('+6 goldberries');
    expect(screen.getByText(/\+12s before he chases/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Share the feast/ })).not.toBeInTheDocument();
    mock.members = []; rerender(<ClickDropdown />);
    expect(screen.queryByLabelText('Feast rewards earned')).not.toBeInTheDocument();
    expect(screen.getByText(/Grow one to earn your own gifts/)).toBeVisible();
  });
});
