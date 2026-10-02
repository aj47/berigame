import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVENTURE_CAMP, PATHS, SKILL_MAX_XP, TECHNIQUES, xpForLevel } from '@sim';
import SkillsPanel from '../Components/SkillsPanel';

const mock = vi.hoisted(() => ({
  me: null as any,
  skills: null as any,
  profiles: [] as any[],
  equipTechnique: vi.fn(),
  setTarget: vi.fn(),
}));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me,
  useMySkills: () => mock.skills,
  useMyCosmetics: () => null,
  useAdventureProfiles: () => mock.profiles,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
vi.mock('../spacetime/stores/progressStore', () => ({ useProgressStore: (select: any) => select({ banner: null }) }));

const onClose = vi.fn(), onStyle = vi.fn();
const panel = () => <SkillsPanel open onClose={() => onClose()} onStyle={() => onStyle()} />;
const selectPath = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}, level`) }));
const expandTechnique = (name: string) => {
  const details = screen.getByText(name, { selector: 'summary strong' }).closest('details')!;
  fireEvent.click(details.querySelector('summary')!);
  return within(details);
};
const profile = (overrides: Record<string, unknown> = {}) => ({
  identity: mock.me.identity,
  growingXp: xpForLevel(4), buildingXp: xpForLevel(4), exploringXp: xpForLevel(4),
  fightingXp: xpForLevel(4), befriendingXp: xpForLevel(4), feats: 127, loadout: 0,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.me = { identity: { toHexString: () => 'self' }, ...ADVENTURE_CAMP };
  mock.skills = null;
  mock.profiles = [];
});
afterEach(cleanup);

describe('compact skills menu', () => {
  it('shows one path at a time and keeps every technique reachable', () => {
    render(panel());
    expect(screen.getAllByText('Locked')).toHaveLength(3);
    expect(screen.queryByText('Brace')).not.toBeInTheDocument();
    expect(screen.getByText('Gathering & recipes').closest('details')).not.toHaveAttribute('open');
    for (const [path, name] of PATHS.entries()) {
      selectPath(name);
      expect(screen.getByRole('region', { name: `${name} techniques` })).toBeInTheDocument();
      for (const technique of TECHNIQUES.filter(t => t.path === path)) {
        const details = screen.getByText(technique.name).closest('details')!;
        expect(details).not.toHaveAttribute('open');
        expect(expandTechnique(technique.name).getByText(technique.description)).toBeVisible();
      }
    }
    expect(mock.equipTechnique).not.toHaveBeenCalled();
  });

  it('shows which level and activity requirements still need completing', () => {
    mock.profiles = [profile({ growingXp: xpForLevel(2), feats: 0 })];
    render(panel());
    const seed = expandTechnique('Seed sense');
    const requirements = seed.getByRole('list', { name: 'Seed sense requirements' });
    expect(within(requirements).getByText('Growing level 2').closest('li')).toHaveAttribute('data-met', 'true');
    expect(within(requirements).getByText('Harvest a berry or grow an expedition seed').closest('li')).toHaveAttribute('data-met', 'false');
    expect(seed.queryByRole('button', { name: 'Equip Seed sense' })).not.toBeInTheDocument();
    expect(mock.equipTechnique).not.toHaveBeenCalled();
  });

  it('keeps equip and unequip actions correct as the profile updates', () => {
    mock.profiles = [profile()];
    const { rerender } = render(panel());
    selectPath('Befriending');
    const porter = expandTechnique('Porter pact');
    fireEvent.click(porter.getByRole('button', { name: 'Equip Porter pact' }));
    expect(mock.equipTechnique).toHaveBeenLastCalledWith(13);
    mock.profiles = [profile({ loadout: 1 << 13 })];
    rerender(panel());
    expect(screen.getByRole('region', { name: 'Befriending techniques' })).toBeInTheDocument();
    expect(screen.getByText('1/3 equipped')).toBeInTheDocument();
    fireEvent.click(porter.getByRole('button', { name: 'Unequip Porter pact' }));
    expect(mock.equipTechnique).toHaveBeenCalledTimes(2);
    expect(mock.equipTechnique).toHaveBeenLastCalledWith(13);
  });

  it('offers a route to camp and only enables changes once the player arrives', () => {
    mock.profiles = [profile()];
    mock.me = { ...mock.me, x: 40, z: 40 };
    const { rerender } = render(panel());
    const seed = expandTechnique('Seed sense');
    expect(seed.getByRole('button', { name: 'Equip Seed sense' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Walk to camp' }));
    expect(mock.setTarget).toHaveBeenCalledExactlyOnceWith(ADVENTURE_CAMP.x, ADVENTURE_CAMP.z);
    mock.me = { ...mock.me, ...ADVENTURE_CAMP };
    rerender(panel());
    expect(seed.getByRole('button', { name: 'Equip Seed sense' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Walk to camp' })).not.toBeInTheDocument();
  });

  it('allows removing a technique from a full loadout while blocking a fourth', () => {
    mock.profiles = [profile({ loadout: 7 })];
    render(panel());
    expect(expandTechnique('Seed sense').getByRole('button', { name: 'Unequip Seed sense' })).toBeEnabled();
    selectPath('Building');
    expect(expandTechnique('Berry basket').getByRole('button', { name: 'Equip Berry basket' })).toBeDisabled();
    expect(screen.getByText('Unequip one to make room.')).toBeInTheDocument();
  });

  it('preserves legacy progress, max levels and the Skills/Style controls', () => {
    mock.skills = { foragingXp: SKILL_MAX_XP, beachcombingXp: 0, craftingXp: 0 };
    render(panel());
    expect(screen.getByRole('button', { name: 'Growing, level 30, max level' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('region', { name: 'Growing techniques' })).getByText('Max level')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Gathering & recipes'));
    expect(screen.getByRole('progressbar', { name: 'Foraging progress to the next level' })).toHaveAttribute('aria-valuenow', '100');
    fireEvent.click(screen.getByRole('tab', { name: 'Style' }));
    expect(onStyle).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close skills' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
