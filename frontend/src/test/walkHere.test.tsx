import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ray, Vector3 } from 'three';
import { SPAWN_TILE, tileToWorld } from '@sim';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';
import { openAdventureInteraction } from '../Components/3D/adventureInteraction';

const mock = vi.hoisted(() => ({ walk:vi.fn(), frontier:vi.fn(), action:vi.fn(), adventure:vi.fn() }));
vi.mock('../spacetime/actions', () => ({ useGameActions:()=>({setTarget:mock.walk, frontier:mock.frontier}) }));
vi.mock('../spacetime/hooks', () => ({usePlayersByHex:()=>new Map(),useMyIdentityHex:()=> 'self'}));
vi.mock('../Components/PlayerInteraction', () => ({default:()=> null}));
vi.mock('../Components/GroundPickupActions', () => ({default:()=> <button>Legacy island pickup</button>}));
vi.mock('../Components/HarvestDropdownAction', () => ({default:()=> <button onClick={mock.action}>Harvest</button>}));
vi.mock('../Components/BerryGiantInteraction', () => ({default:()=> <button onClick={mock.action}>Drop bait</button>}));
vi.mock('../Components/adventureNavigation', () => ({openAdventure:mock.adventure}));
const event = () => ({clientX:120,clientY:120,ray:new Ray(new Vector3(...tileToWorld(SPAWN_TILE)).add(new Vector3(0,5,0)),new Vector3(0,-1,0))});
beforeEach(()=>{vi.clearAllMocks();useUserInputStore.getState().setClickedOtherObject(null);});
afterEach(cleanup);

describe('Walk here menu action', () => {
  it.each([
    {connectionId:'Tree',harvestNodeId:1},
    {connectionId:'Berry Giant',berryGiantExpeditionId:1n},
    {connectionId:'Choose player',playerChoices:['a','b']},
    {connectionId:'Training dummy',dropdownOptions:[{label:'Attack',onClick:mock.action}]},
  ])('walks from $connectionId without performing its interaction', selection => {
    useUserInputStore.getState().setClickedOtherObject({...selection,e:event()});
    render(<ClickDropdown/>);
    fireEvent.click(screen.getByRole('button',{name:'Walk here',exact:true}));
    expect(mock.walk).toHaveBeenCalledExactlyOnceWith(SPAWN_TILE.x,SPAWN_TILE.z);
    expect(mock.action).not.toHaveBeenCalled();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
  it('lets adventure props offer walking before opening their panel', () => {
    openAdventureInteraction('Berry drop-off',event(),'market');render(<ClickDropdown/>);
    expect(mock.adventure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Walk here',exact:true}));
    expect(mock.walk).toHaveBeenCalledOnce();expect(mock.adventure).not.toHaveBeenCalled();
    act(() => openAdventureInteraction('Berry drop-off',event(),'market'));
    fireEvent.click(screen.getByRole('button',{name:'View berry delivery',exact:true}));
    expect(mock.adventure).toHaveBeenCalledExactlyOnceWith('market');
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });
  it.each([
    ['Giant’s feast', 'feast', 'Visit the Giant’s feast'],
    ['Camp workshop', 'workshop', 'Help build the workshop'],
    ['The gardener', 'expedition', 'View giant berry adventure'],
  ] as const)('routes %s to its own activity', (name, view, label) => {
    openAdventureInteraction(name,event(),view);render(<ClickDropdown/>);
    fireEvent.click(screen.getByRole('button',{name:label,exact:true}));
    expect(mock.adventure).toHaveBeenCalledExactlyOnceWith(view);
  });
  it('opens the giant berry activity for cargo and helpers by default', () => {
    openAdventureInteraction('Moss',event());render(<ClickDropdown/>);
    fireEvent.click(screen.getByRole('button',{name:'View giant berry adventure',exact:true}));
    expect(mock.adventure).toHaveBeenCalledExactlyOnceWith('expedition');
  });
  it('does not offer a movement action without a valid ground destination', () => {
    useUserInputStore.getState().setClickedOtherObject({connectionId:'Tree',harvestNodeId:1,e:{clientX:120,clientY:120}});
    render(<ClickDropdown/>);expect(screen.queryByRole('button',{name:'Walk here'})).not.toBeInTheDocument();
  });
  it.each([
    ['bramblewild', 69, 25, { action: 'walk', id: 'settlement', x: 5, z: 64 }],
    ['settlement', 69, 25, { action: 'walk', id: 'settlement', x: 5, z: 64 }],
    ['settlement', 61, 25, { action: 'walk', id: 'bramblewild', x: 61, z: 25 }],
    ['reedwake', 31, 65, { action: 'move', x: 31, z: 65 }],
    ['cinder', 80, 60, { action: 'move', x: 80, z: 60 }],
    ['sea', 50, 50, { action: 'sail', x: 50, z: 50 }],
  ] as const)('routes %s scene clicks at %i,%i through the correct district action', (region, x, z, expected) => {
    useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Player', playerChoices: ['other'], playerHex: 'other',
      e: { clientX: 120, clientY: 120, ray: new Ray(new Vector3(x - 25, 5, z - 25), new Vector3(0, -1, 0)) } });
    render(<ClickDropdown region={region} />);
    fireEvent.click(screen.getByRole('button', { name: 'Walk here', exact: true }));
    expect(mock.frontier).toHaveBeenCalledExactlyOnceWith(expected);
    expect(mock.walk).not.toHaveBeenCalled();
  });
  it.each([
    ['settlement', 'bramblewild'], ['reedwake', 'reedwake'], ['bramblewild', 'settlement'],
  ])('does not offer legacy ground items for viewer %s and selected ground %s', (region, groundRegion) => {
    useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Player', groundRegion, groundTiles: [{ x: 25, z: 25 }], dropdownOptions: [] });
    render(<ClickDropdown region={region} />);
    expect(screen.queryByRole('button', { name: 'Legacy island pickup' })).not.toBeInTheDocument();
  });
  it('keeps island ground pickups available on their own map', () => {
    useUserInputStore.getState().setClickedOtherObject({ connectionId: 'Ground', groundRegion: 'bramblewild', groundTiles: [{ x: 25, z: 25 }], dropdownOptions: [] });
    render(<ClickDropdown region="bramblewild" />);
    expect(screen.getByRole('button', { name: 'Legacy island pickup' })).toBeVisible();
  });
});
