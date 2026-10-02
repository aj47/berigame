import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVENTURE_CAMP, BERRY_MARKET, BERRY_PATCH, GIANT_FEAST, PlayerState } from '@sim';
import AdventurePanel, { AdventureHud } from '../Components/AdventurePanel';

const mock = vi.hoisted(() => ({
  me: null as any,
  players: [] as any[],
  members: [] as any[],
  expeditions: [] as any[],
  profiles: [] as any[],
  inventory: [] as any[],
  duels: [] as any[],
  tick: 100,
  setTarget: vi.fn().mockResolvedValue(true),
  expeditionAction: vi.fn().mockResolvedValue(true),
  contributeProject: vi.fn().mockResolvedValue(true),
  shareGarden: vi.fn().mockResolvedValue(true),
  duelAction: vi.fn().mockResolvedValue(true),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me,
  usePlayers: () => mock.players,
  useExpeditionMembers: () => mock.members,
  useExpeditions: () => mock.expeditions,
  useAdventureProfiles: () => mock.profiles,
  useInventoryRows: () => mock.inventory,
  useFriendlyDuels: () => mock.duels,
  useTick: () => mock.tick,
  useIslandProjects: () => [{ id: 0, wood: 8, obsidian: 3, meals: 4 }],
  useGardenShowcases: () => [],
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({
  setTarget: mock.setTarget,
  expeditionAction: mock.expeditionAction,
  contributeProject: mock.contributeProject,
  shareGarden: mock.shareGarden,
  duelAction: mock.duelAction,
}) }));

const identity = (value: string) => ({ toHexString: () => value });
const onClose = vi.fn();
const clickAction = async (name: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })); });
};
const panel = (initialView: React.ComponentProps<typeof AdventurePanel>['initialView'] = 'expedition') =>
  <AdventurePanel open onClose={onClose} initialView={initialView} />;
function expedition(overrides: Record<string, unknown> = {}) {
  mock.members = [{ identity: mock.me.identity, expeditionId: 1n, cooldown: 0, tracked: false }];
  mock.expeditions = [{
    id: 1n, leader: mock.me.identity, stage: 'hauling', destination: 'market',
    ...BERRY_PATCH, ripeTick: 120, untilTick: 500, value: 4,
    carrier: undefined, mossCarrying: false, split: false,
    pipX: 36, pipZ: 20, giantX: 36, giantZ: 29,
    message: 'The berry is ready for its next adventure.',
    ...overrides,
  }];
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.me = { identity: identity('me'), name: 'AJ', ...ADVENTURE_CAMP, online: true, state: PlayerState.Alive, hostile: false };
  mock.players = [mock.me];
  mock.members = [];
  mock.expeditions = [];
  mock.profiles = [];
  mock.inventory = [];
  mock.duels = [];
  mock.tick = 100;
});
afterEach(cleanup);

describe('feast payoff', () => {
  it('shows a helper’s exact reward once when viewing the completed feast', () => {
    expedition({ stage: 'complete', destination: 'feast', value: 4 });
    mock.members[0].contributions = 1;
    mock.profiles = [{ identity: mock.me.identity, giantTrust: 1 }];
    render(panel('feast'));
    expect(screen.getAllByLabelText('Feast rewards earned')).toHaveLength(1);
    expect(screen.getByLabelText('Feast rewards earned')).toHaveTextContent('+6 goldberries');
    expect(screen.queryByLabelText('Feast rewards')).not.toBeInTheDocument();
    expect(screen.getByText(/\+12s before he chases/)).toBeVisible();
  });

  it('keeps idle members out of the earned-reward summary and HUD friendship claim', () => {
    expedition({ stage: 'complete', destination: 'feast', value: 4 });
    mock.members[0].contributions = 0;
    render(<>{panel('feast')}<AdventureHud visible /></>);
    expect(screen.queryByLabelText('Feast rewards earned')).not.toBeInTheDocument();
    expect(screen.queryByText('♥ You made a very big friend!')).not.toBeInTheDocument();
    expect(screen.getByText('The crew shared a feast!')).toBeVisible();
  });
});

describe('focused adventure navigation', () => {
  it('opens a delivery explanation at the drop-off and leads into planting without starting anything', () => {
    render(panel('market'));
    expect(screen.getByRole('heading', { name: 'Berry drop-off' })).toBeInTheDocument();
    expect(screen.queryByText('Camp workshop')).not.toBeInTheDocument();
    expect(screen.queryByText('Garden visits')).not.toBeInTheDocument();
    expect(screen.queryByText('Friendly duels')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start a berry delivery' }));
    expect(screen.getByRole('heading', { name: 'Giant berry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Berry drop-off Share with the village/ })).toHaveAttribute('aria-pressed', 'true');
    expect(mock.expeditionAction).not.toHaveBeenCalled();
  });

  it.each([
    ['Grow a giant berry', 'Giant berry'],
    ['Camp workshop', 'Camp workshop'],
    ['Garden visits', 'Garden visits'],
    ['Friendly duels', 'Friendly duels'],
  ])('opens %s from the hub and returns to the activity choices', (label, heading) => {
    render(panel('hub'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
    expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /All adventures/ }));
    expect(screen.getByRole('heading', { name: 'Adventure' })).toBeInTheDocument();
  });

  it('walks a distant player to camp and enables planting when they arrive', async () => {
    Object.assign(mock.me, { x: 40, z: 40 });
    const { rerender } = render(panel());
    await clickAction('Walk to camp');
    await waitFor(() => expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(ADVENTURE_CAMP.x, ADVENTURE_CAMP.z));
    Object.assign(mock.me, ADVENTURE_CAMP);
    rerender(panel());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Plant a giant berry' })).toBeEnabled());
    await clickAction('Plant a giant berry');
    expect(mock.expeditionAction).toHaveBeenCalledExactlyOnceWith('start', 0n, { destination: 'market' });
  });

  it('preserves the feast route from its landmark through planting', async () => {
    render(panel('feast'));
    fireEvent.click(screen.getByRole('button', { name: 'Grow a feast for the Giant' }));
    expect(screen.getByRole('button', { name: /Giant’s feast Make a very big friend/ })).toHaveAttribute('aria-pressed', 'true');
    await clickAction('Plant a giant berry');
    expect(mock.expeditionAction).toHaveBeenCalledExactlyOnceWith('start', 0n, { destination: 'feast' });
  });

  it('keeps a feast adventure intact when the player visits the berry drop-off', async () => {
    expedition({ destination: 'feast', carrier: mock.me.identity });
    render(panel('market'));
    expect(screen.getByText('Your berry is headed to the Giant’s feast.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share the berry' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Continue berry adventure/ }));
    await clickAction('Walk to feast');
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(GIANT_FEAST.x, GIANT_FEAST.z);
    expect(mock.expeditionAction).not.toHaveBeenCalled();
  });
});

describe('live next action', () => {
  it('changes from walking to growing, picking up, carrying, and sharing as the adventure advances', async () => {
    expedition({ stage: 'growing' });
    const { rerender } = render(panel());
    await clickAction('Walk to berry');
    await waitFor(() => expect(mock.setTarget).toHaveBeenCalledWith(BERRY_PATCH.x, BERRY_PATCH.z));
    Object.assign(mock.me, BERRY_PATCH);
    rerender(panel());
    expect(screen.getByRole('button', { name: 'Growing · 12s' })).toBeDisabled();
    mock.expeditions[0].stage = 'hauling';
    rerender(panel());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick up berry' })).toBeEnabled());
    await clickAction('Pick up berry');
    await waitFor(() => expect(mock.expeditionAction).toHaveBeenCalledWith('take', 1n, {}));
    mock.expeditions[0].carrier = mock.me.identity;
    rerender(panel());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Walk to drop-off' })).toBeEnabled());
    await clickAction('Walk to drop-off');
    await waitFor(() => expect(mock.setTarget).toHaveBeenLastCalledWith(BERRY_MARKET.x, BERRY_MARKET.z));
    Object.assign(mock.me, BERRY_MARKET);
    rerender(panel());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share the berry' })).toBeEnabled());
    await clickAction('Share the berry');
    expect(mock.expeditionAction).toHaveBeenLastCalledWith('deliver', 1n, {});
  });

  it('uses the feast destination for both walking and finishing', async () => {
    expedition({ destination: 'feast', carrier: mock.me.identity });
    const { rerender } = render(panel('feast'));
    await clickAction('Walk to feast');
    await waitFor(() => expect(mock.setTarget).toHaveBeenCalledWith(GIANT_FEAST.x, GIANT_FEAST.z));
    Object.assign(mock.me, GIANT_FEAST);
    rerender(panel('feast'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Feed the Giant' })).toBeEnabled());
    await clickAction('Feed the Giant');
    expect(mock.expeditionAction).toHaveBeenLastCalledWith('feed', 1n, {});
  });

  it('requires proximity to grounded cargo even when the cargo is at its destination', async () => {
    expedition(BERRY_MARKET);
    render(panel());
    expect(screen.queryByRole('button', { name: 'Share the berry' })).not.toBeInTheDocument();
    await clickAction('Walk to berry');
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(BERRY_MARKET.x, BERRY_MARKET.z);
    expect(mock.expeditionAction).not.toHaveBeenCalled();
  });

  it('follows a teammate instead of offering to take or finish their berry', async () => {
    const teammate = { ...mock.me, identity: identity('friend'), ...BERRY_MARKET };
    mock.players.push(teammate);
    Object.assign(mock.me, BERRY_MARKET);
    expedition({ carrier: teammate.identity });
    render(panel());
    expect(screen.queryByRole('button', { name: 'Pick up berry' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share the berry' })).not.toBeInTheDocument();
    await clickAction('Follow the berry');
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(BERRY_MARKET.x, BERRY_MARKET.z);
    expect(mock.expeditionAction).not.toHaveBeenCalled();
  });

  it.each([
    ['market', 'Lead Moss to drop-off', BERRY_MARKET],
    ['feast', 'Lead Moss to feast', GIANT_FEAST],
  ])('leads Moss toward %s when Porter pact makes him follow the player', async (destination, label, goal) => {
    mock.profiles = [{ identity: mock.me.identity, loadout: 1 << 13 }];
    expedition({ destination, mossCarrying: true, porter: mock.me.identity });
    render(panel());
    expect(screen.queryByRole('button', { name: 'Follow the berry' })).not.toBeInTheDocument();
    await clickAction(label);
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(goal.x, goal.z);
    expect(mock.expeditionAction).not.toHaveBeenCalled();
  });

  it('keeps movement available during the action cooldown', () => {
    expedition();
    mock.members[0].cooldown = 110;
    const { rerender } = render(panel());
    expect(screen.getByRole('button', { name: 'Walk to berry' })).toBeEnabled();
    Object.assign(mock.me, BERRY_PATCH);
    rerender(panel());
    expect(screen.getByRole('button', { name: 'Pick up berry' })).toBeDisabled();
    mock.tick = 110;
    rerender(panel());
    expect(screen.getByRole('button', { name: 'Pick up berry' })).toBeEnabled();
  });

  it.each(['complete', 'lost'])('removes stale hauling actions and the HUD after an expedition is %s', stage => {
    expedition({ stage, carrier: mock.me.identity });
    render(<>{panel()}<AdventureHud visible /></>);
    expect(screen.getByRole('status')).toHaveTextContent(stage === 'complete' ? 'Nice work, berry crew!' : 'The berry got away!');
    expect(screen.getByRole('button', { name: 'Plant a giant berry' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Walk to drop-off|Pick up berry|Share the berry|Put berry down|Giant berry adventure/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Berry tricks & friends')).not.toBeInTheDocument();
  });
});
