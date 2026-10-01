import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cosmetic, CosmeticSlot, DEFAULT_APPEARANCE } from '@sim';
import AppearancePanel from '../Components/AppearancePanel';
import CharacterSetup from '../Components/CharacterSetup';
import { useAppearancePreview } from '../appearance/store';
import { useLoadingStore } from '../store';

const mock = vi.hoisted(() => ({ rows: [] as any[], cosmetics: null as any, me: {name:'Explorer',identity:{toHexString:()=> 'self'}}, saveCharacter: vi.fn().mockResolvedValue(true), wearCosmetic: vi.fn().mockResolvedValue(true) }));
vi.mock('../spacetime/hooks', () => ({ useMyIdentityHex: () => 'self', useMyPlayer:()=>mock.me, useAppearanceRows: () => mock.rows, useMyCosmetics: () => mock.cosmetics }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ saveCharacter: mock.saveCharacter, wearCosmetic: mock.wearCosmetic }) }));
vi.mock('../Components/CharacterPreview',()=>({default:({head,neck}:any)=> <div data-testid="character-preview" data-head={head} data-neck={neck}>3D preview</div>}));
beforeEach(() => { mock.rows = []; mock.cosmetics = null; mock.me.name='Explorer'; mock.saveCharacter.mockReset().mockResolvedValue(true); mock.wearCosmetic.mockReset().mockResolvedValue(true); useAppearancePreview.setState({ draft: null });useLoadingStore.setState({gameDataLoaded:true,websocketConnected:true}); });
afterEach(() => cleanup());
const tab=(name:string)=>fireEvent.click(screen.getByRole('tab',{name,exact:true}));

describe('character preview and persistence boundary', () => {
  it('keeps hat and scarf preview in sync with equipment updates while preserving the style draft', async () => {
    mock.cosmetics = { unlocked: (1 << Cosmetic.StrawHat) | (1 << Cosmetic.CoastScarf), head: Cosmetic.StrawHat + 1, neck: Cosmetic.CoastScarf + 1 };
    const { rerender } = render(<AppearancePanel open onClose={()=>{}}/>);
    const preview = screen.getByTestId('character-preview');
    expect(preview).toHaveAttribute('data-head', String(Cosmetic.StrawHat + 1));
    expect(preview).toHaveAttribute('data-neck', String(Cosmetic.CoastScarf + 1));
    tab('Hair'); fireEvent.click(screen.getByRole('button',{name:'Twin braids',exact:true}));
    tab('Details');
    const head = within(screen.getByText('Head').parentElement!);
    const neck = within(screen.getByText('Neck').parentElement!);
    fireEvent.click(head.getByRole('button', { name: 'None', exact: true }));
    await waitFor(()=>expect(mock.wearCosmetic).toHaveBeenCalledWith(CosmeticSlot.Head, 0));
    mock.cosmetics = {...mock.cosmetics, head: 0}; rerender(<AppearancePanel open onClose={()=>{}}/>);
    expect(preview).toHaveAttribute('data-head', '0');
    expect(preview).toHaveAttribute('data-neck', String(Cosmetic.CoastScarf + 1));
    await act(async()=>fireEvent.click(neck.getByRole('button', { name: 'None', exact: true })));
    expect(mock.wearCosmetic).toHaveBeenCalledWith(CosmeticSlot.Neck, 0);
    mock.cosmetics = {...mock.cosmetics, neck: 0}; rerender(<AppearancePanel open onClose={()=>{}}/>);
    expect(preview).toHaveAttribute('data-neck', '0');
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Straw Hat',exact:true})));
    expect(mock.wearCosmetic).toHaveBeenCalledWith(CosmeticSlot.Head, Cosmetic.StrawHat + 1);
    await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Coast Scarf',exact:true})));
    expect(mock.wearCosmetic).toHaveBeenCalledWith(CosmeticSlot.Neck, Cosmetic.CoastScarf + 1);
    mock.cosmetics = {...mock.cosmetics, head: Cosmetic.StrawHat + 1, neck: Cosmetic.CoastScarf + 1};
    rerender(<AppearancePanel open onClose={()=>{}}/>);
    expect(preview).toHaveAttribute('data-head', String(Cosmetic.StrawHat + 1));
    expect(preview).toHaveAttribute('data-neck', String(Cosmetic.CoastScarf + 1));
    expect(useAppearancePreview.getState().draft?.hairStyle).toBe(7);
    expect(mock.saveCharacter).not.toHaveBeenCalled();
  });
  it('previews extended choices locally and saves name and full appearance together', async () => {
    const close = vi.fn(); render(<AppearancePanel open onClose={close} />);
    fireEvent.change(screen.getByLabelText('What should we call you?'),{target:{value:'  Fern  '}});
    tab('Hair'); fireEvent.click(screen.getByRole('button',{name:'Twin braids',exact:true}));
    tab('Face'); fireEvent.click(screen.getByRole('button',{name:'Broad',exact:true}));
    tab('Details'); fireEvent.click(screen.getByRole('button',{name:'Round glasses',exact:true}));
    expect(mock.saveCharacter).not.toHaveBeenCalled();
    expect(useAppearancePreview.getState().draft).toEqual({...DEFAULT_APPEARANCE,hairStyle:7,bodyType:2,accessory:1});
    fireEvent.click(screen.getByRole('button',{name:'Save character',exact:true}));
    await waitFor(()=>expect(close).toHaveBeenCalledOnce());
    expect(mock.saveCharacter).toHaveBeenCalledWith('Fern',{...DEFAULT_APPEARANCE,hairStyle:7,bodyType:2,accessory:1});
    expect(useAppearancePreview.getState().draft).toBeNull();
  });
  it('Cancel and external panel switching clear the draft without saving', () => {
    const close=vi.fn(); const {rerender}=render(<AppearancePanel open onClose={close}/>);
    fireEvent.click(screen.getByRole('button',{name:/Sunseeker/}));
    fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));
    expect(mock.saveCharacter).not.toHaveBeenCalled();expect(close).toHaveBeenCalledOnce();expect(useAppearancePreview.getState().draft).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/Woodland/}));
    rerender(<AppearancePanel open={false} onClose={close}/>);expect(useAppearancePreview.getState().draft).toBeNull();
  });
  it('opens own saved appearance, preserves drafts during server updates, and reopens the latest row',()=>{
    mock.rows=[{...DEFAULT_APPEARANCE,hairStyle:5,identity:mock.me.identity},{...DEFAULT_APPEARANCE,hairStyle:7,identity:{toHexString:()=> 'other'}}];
    const {rerender}=render(<AppearancePanel open onClose={()=>{}}/>);
    tab('Hair');expect(screen.getByRole('button',{name:'Bob',exact:true})).toHaveAttribute('aria-pressed','true');
    fireEvent.click(screen.getByRole('button',{name:'Mohawk',exact:true}));
    mock.rows[0]={...mock.rows[0],hairStyle:6};rerender(<AppearancePanel open onClose={()=>{}}/>);
    expect(screen.getByRole('button',{name:'Mohawk',exact:true})).toHaveAttribute('aria-pressed','true');
    rerender(<AppearancePanel open={false} onClose={()=>{}}/>);rerender(<AppearancePanel open onClose={()=>{}}/>);tab('Hair');
    expect(screen.getByRole('button',{name:'Ponytail',exact:true})).toHaveAttribute('aria-pressed','true');
  });
  it('retains failed choices for retry',async()=>{
    mock.saveCharacter.mockResolvedValue(false);const close=vi.fn();render(<AppearancePanel open onClose={close}/>);
    fireEvent.click(screen.getByRole('button',{name:/Stargazer/}));fireEvent.click(screen.getByRole('button',{name:'Save character'}));
    await screen.findByRole('alert');expect(close).not.toHaveBeenCalled();expect(useAppearancePreview.getState().draft?.robeColor).toBe(3);
    expect(screen.getByRole('button',{name:'Save character'})).toBeEnabled();
  });
  it('ignores a late save response after leaving',async()=>{
    let finish!:(result:boolean)=>void;mock.saveCharacter.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const close=vi.fn();const {rerender}=render(<AppearancePanel open onClose={close}/>);
    fireEvent.click(screen.getByRole('button',{name:/Stargazer/}));fireEvent.click(screen.getByRole('button',{name:'Save character'}));
    rerender(<AppearancePanel open={false} onClose={close}/>);finish(true);await waitFor(()=>expect(mock.saveCharacter).toHaveBeenCalledOnce());
    expect(close).not.toHaveBeenCalled();expect(useAppearancePreview.getState().draft).toBeNull();
  });
  it('requires a valid name on the first visit and cannot be dismissed accidentally',()=>{
    const close=vi.fn();render(<AppearancePanel open firstVisit onClose={close}/>);
    expect(screen.queryByRole('button',{name:'Cancel'})).toBeNull();
    const enter=screen.getByRole('button',{name:'Enter the island →'}),input=screen.getByLabelText('What should we call you?');
    expect(enter).toBeDisabled();fireEvent.change(input,{target:{value:'!'}});expect(enter).toBeDisabled();
    fireEvent.keyDown(input,{key:'Escape'});expect(close).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:'Fern'}});expect(enter).toBeEnabled();
  });
  it('shows setup only for an unfinished newcomer after subscription readiness',()=>{
    mock.me.name='Player-1234';useLoadingStore.setState({gameDataLoaded:false});const {rerender}=render(<CharacterSetup/>);
    expect(screen.queryByRole('dialog')).toBeNull();act(()=>useLoadingStore.setState({gameDataLoaded:true}));rerender(<CharacterSetup/>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    mock.rows=[{...DEFAULT_APPEARANCE,identity:mock.me.identity,setupComplete:true}];rerender(<CharacterSetup/>);expect(screen.queryByRole('dialog')).toBeNull();
    mock.rows=[];mock.me.name='Existing Player';rerender(<CharacterSetup/>);expect(screen.queryByRole('dialog')).toBeNull();
  });
});
