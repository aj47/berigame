import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

// On /watch the spectator cannot read the watched player's private expeditionPaid row.
const identity = (value: string) => ({ toHexString: () => value });
const me = { identity: identity('me') };
vi.mock('../spacetime/viewer', () => ({ WATCHING: true }));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => me,
  useExpeditionMembers: () => [{ identity: me.identity, expeditionId: 1n, contributions: 1 }],
  useExpeditions: () => [{ id: 1n, stage: 'complete', destination: 'market', value: 4 }],
  useExpeditionPaid: () => undefined,
  useFriendlyDuels: () => [], useTick: () => 100,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({}) }));
import { AdventureHud } from '../Components/AdventurePanel';
afterEach(cleanup);

it('shows the plain completion line, not "XP only", for a watched player', () => {
  render(<AdventureHud visible />);
  expect(screen.getByText('Berry delivered!')).toBeVisible();
  expect(screen.queryByText(/XP only/)).not.toBeInTheDocument();
  expect(screen.getByText(/Expedition complete · See rewards/)).toBeVisible();
});
