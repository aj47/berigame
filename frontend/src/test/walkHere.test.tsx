import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ray, Vector3 } from 'three';
import { SPAWN_TILE, tileToWorld } from '@sim';
import ClickDropdown from '../Components/ClickDropdown';
import { useUserInputStore } from '../store';
import { openAdventureInteraction } from '../Components/3D/adventureInteraction';

const mock = vi.hoisted(() => ({ walk:vi.fn(), action:vi.fn(), adventure:vi.fn() }));
vi.mock('../spacetime/actions', () => ({ useGameActions:()=>({setTarget:mock.walk}) }));
vi.mock('../spacetime/hooks', () => ({usePlayersByHex:()=>new Map(),useMyIdentityHex:()=> 'self'}));
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
});
