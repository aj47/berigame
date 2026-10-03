import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerState } from '@sim';
import PlayerAvatar from '../Components/3D/PlayerAvatar';
import { Animal } from '../frontier/FrontierWorld';
import { useSettingsStore } from '../spacetime/stores/settingsStore';
import { useUserInputStore } from '../store';
import { holdState } from '../Components/3D/tapAssist';

const mock = vi.hoisted(() => ({ me: null as any, tick: 100, attack: vi.fn(), frontier: vi.fn(), approach: vi.fn(), openSettlement: vi.fn() }));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useTick: () => mock.tick, useExpeditions: () => [], useWornCosmetics: () => 0,
}));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => mock }));
vi.mock('../frontier/worldInteraction', () => ({ approachWorldInteraction: mock.approach }));
vi.mock('../frontier/navigation', () => ({ openSettlement: mock.openSettlement }));
vi.mock('../frontier/useResourceHarvest', () => ({ useResourceHarvest: () => null }));
vi.mock('../hooks/useTileMotion', () => ({ useTileMotion: () => ({ current: {} }) }));
vi.mock('../Components/3D/AdventurerModel', () => ({ default: () => null, BASE_MODEL_URL: 'avatar', modelUrl: () => 'avatar' }));
vi.mock('../Components/3D/AvatarDecals', () => ({ default: () => null, useAvatarDecal: () => {} }));
vi.mock('../Components/3D/AvatarOverlay', () => ({ AvatarOverlay: () => null, useAvatarLabels: () => {} }));
vi.mock('../Components/3D/CameraController', () => ({ default: () => null }));
vi.mock('../Components/3D/RenderOnlineUsers', () => ({ useAppearanceByHex: () => new Map() }));
vi.mock('../Components/3D/AdventureModels', () => ({ AdventureAssetView: () => null }));
vi.mock('../frontier/MeadowScenery', () => ({ default: () => null, ResourceModel: () => null }));
vi.mock('../frontier/MeadowTownSquare', () => ({ default: () => null }));
vi.mock('@react-three/fiber', () => ({ useFrame: () => {}, Canvas: () => null, useThree: () => ({}) }));
vi.mock('@react-three/drei', () => ({ Html: () => null }));

const identity = (hex: string) => ({ toHexString: () => hex });
const player = (patch = {}) => ({
  identity: identity('other'), name: 'Other player', online: true, state: PlayerState.Alive,
  x: 35, z: 25, region: 'bramblewild', respawnTick: 0, hp: 30, maxHp: 30, ...patch,
}) as any;
const creature = (patch = {}) => ({
  id: 'bristle', species: 'bristleback', region: 'settlement', x: 50, z: 50,
  hp: 30, restUntil: 0, owner: '', trained: false, active: true, nextMove: 0, ...patch,
}) as any;
const selected = () => useUserInputStore.getState().clickedOtherObject;
function props(container: HTMLElement) {
  const group = container.querySelector('group') as any;
  return group[Object.keys(group).find(key => key.startsWith('__reactProps$'))!];
}
function click(container: HTMLElement, patch = {}) {
  act(() => props(container).onClick?.({ delta: 0, button: 0, stopPropagation: vi.fn(), clientX: 100, clientY: 100, ...patch }));
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.me = player({ identity: identity('me'), x: 32 });
  useSettingsStore.setState({ oneClickAttack: false });
  useUserInputStore.getState().setClickedOtherObject(null);
  holdState.active = false; holdState.suppressClickUntil = 0;
});
afterEach(cleanup);

describe('one-click player attacks', () => {
  it('preserves player options by default and switches the click and hover behavior together', () => {
    const row = player();
    const ui = render(<PlayerAvatar row={row} isSelf={false} />);
    click(ui.container);
    expect(selected()).toMatchObject({ playerHex: 'other' });
    expect(mock.attack).not.toHaveBeenCalled();
    act(() => useSettingsStore.setState({ oneClickAttack: true }));
    expect(props(ui.container).userData.hoverTarget).toMatchObject({ action: 'Click to attack', click: 'action', playerHex: 'other' });
    click(ui.container);
    expect(mock.attack).toHaveBeenCalledExactlyOnceWith(row.identity);
    expect(selected()).toBeNull();
    expect(mock.approach).not.toHaveBeenCalled();
  });

  it('keeps the held menu and secondary clicks from attacking', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const ui = render(<PlayerAvatar row={player()} isSelf={false} />);
    click(ui.container, { interaction: 'menu' });
    click(ui.container, { button: 2 });
    expect(mock.attack).not.toHaveBeenCalled();
    expect(selected()).toMatchObject({ playerHex: 'other' });
  });

  it.each(['self', 'dead', 'offline', 'safe target', 'safe attacker', 'protected', 'dead attacker', 'other region'])('does not directly attack %s', kind => {
    useSettingsStore.setState({ oneClickAttack: true });
    const row = player(kind === 'dead' ? { state: PlayerState.Dead } : kind === 'offline' ? { online: false }
      : kind === 'safe target' ? { x: 25 } : kind === 'protected' ? { respawnTick: 100 }
      : kind === 'other region' ? { region: 'settlement' } : {});
    if (kind === 'safe attacker') mock.me.x = 25;
    if (kind === 'dead attacker') mock.me.state = PlayerState.Dead;
    const ui = render(<PlayerAvatar row={row} isSelf={kind === 'self'} />);
    click(ui.container);
    expect(mock.attack).not.toHaveBeenCalled();
    expect(mock.frontier).not.toHaveBeenCalled();
  });

  it('approaches regional players before asking the authoritative frontier combat rules', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    mock.me.region = 'settlement';
    const row = player({ region: 'settlement' });
    const ui = render(<React.StrictMode><PlayerAvatar row={row} isSelf={false} /></React.StrictMode>);
    click(ui.container);
    expect(mock.approach).toHaveBeenCalledWith(expect.objectContaining({ region: 'settlement', x: row.x, z: row.z }), expect.any(Function), 1);
    expect(mock.frontier).not.toHaveBeenCalled();
    act(() => mock.approach.mock.lastCall![1]());
    expect(mock.frontier).toHaveBeenCalledExactlyOnceWith({ action: 'attack', id: 'other' });
    expect(mock.attack).not.toHaveBeenCalled();
  });

  it('does not attack a regional player who becomes unavailable during the approach', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    mock.me.region = 'settlement';
    const row = player({ region: 'settlement' });
    const ui = render(<PlayerAvatar row={row} isSelf={false} />);
    click(ui.container);
    ui.rerender(<PlayerAvatar row={{ ...row, state: PlayerState.Dead }} isSelf={false} />);
    act(() => mock.approach.mock.lastCall![1]());
    expect(mock.frontier).not.toHaveBeenCalled();
  });
});

describe('one-click hostile wildlife attacks', () => {
  it('approaches before attacking a bristleback, with no dropdown', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const row = creature();
    const ui = render(<React.StrictMode><Animal creature={row} showLabel={false} /></React.StrictMode>);
    expect(props(ui.container).userData.hoverTarget).toMatchObject({ action: 'Click to attack', click: 'action' });
    click(ui.container);
    expect(mock.approach).toHaveBeenCalledWith(row, expect.any(Function), 1);
    expect(mock.frontier).not.toHaveBeenCalled();
    act(() => mock.approach.mock.lastCall![1]());
    expect(mock.frontier).toHaveBeenCalledExactlyOnceWith({ action: 'attack', id: 'bristle' });
    expect(selected()).toBeNull();
  });

  it('keeps the explicit attack option when holding for a menu', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const ui = render(<Animal creature={creature()} showLabel={false} />);
    click(ui.container, { interaction: 'menu' });
    act(() => mock.approach.mock.lastCall![1]());
    expect(mock.frontier).not.toHaveBeenCalled();
    act(() => selected().dropdownOptions[0].onClick());
    expect(mock.frontier).toHaveBeenCalledExactlyOnceWith({ action: 'attack', id: 'bristle' });
  });

  it('does not attack a bristleback defeated during the walk', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const row = creature();
    const ui = render(<Animal creature={row} showLabel={false} />);
    click(ui.container);
    ui.rerender(<Animal creature={{ ...row, restUntil: Date.now() + 60_000 }} showLabel={false} />);
    act(() => mock.approach.mock.lastCall![1]());
    expect(mock.frontier).not.toHaveBeenCalled();
  });

  it('leaves friendly wildlife and building mode alone', () => {
    useSettingsStore.setState({ oneClickAttack: true });
    const ui = render(<Animal creature={creature({ species: 'burrowbun' })} showLabel={false} />);
    click(ui.container);
    ui.rerender(<Animal creature={creature()} showLabel={false} disabled />);
    click(ui.container);
    expect(mock.approach).not.toHaveBeenCalled();
    expect(mock.frontier).not.toHaveBeenCalled();
  });
});
