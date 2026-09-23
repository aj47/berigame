import { renderHook, act, cleanup } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { useLoadingStore } from '../store';
const mock=vi.hoisted(()=>({setStance:vi.fn().mockResolvedValue(undefined),setTarget:vi.fn().mockResolvedValue(undefined),show:vi.fn()}));
vi.mock('spacetimedb/react',()=>({useSpacetimeDB:()=>({getConnection:()=>({reducers:{setStance:mock.setStance,setTarget:mock.setTarget}})})}));
vi.mock('../spacetime/stores/toastStore',()=>({useToastStore:(select:any)=>select({show:mock.show})}));
import { useGameActions } from '../spacetime/actions';
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(navigator,'onLine','get').mockReturnValue(true);useLoadingStore.getState().resetLoading();useLoadingStore.getState().setWebsocketConnected(true);useLoadingStore.getState().setGameDataLoaded(true)});
afterEach(()=>{cleanup();vi.restoreAllMocks()});
describe('actions require a live authoritative world',()=>{
 it('does not queue stance or movement input behind a stalled overlay, then accepts a fresh action after recovery',async()=>{
  const {result}=renderHook(()=>useGameActions());useLoadingStore.getState().setWorldUpdatesStalled(true);
  await act(async()=>{for(const stance of[0,1,2])expect(await result.current.setStance(stance)).toBe(false);expect(await result.current.setTarget(20,20)).toBe(false)});
  expect(mock.setStance).not.toHaveBeenCalled();expect(mock.setTarget).not.toHaveBeenCalled();
  useLoadingStore.getState().setWorldUpdatesStalled(false);expect(mock.setStance).not.toHaveBeenCalled();
  await act(async()=>{expect(await result.current.setStance(2)).toBe(true)});expect(mock.setStance).toHaveBeenCalledExactlyOnceWith({stance:2});
 });
 it('blocks immediate offline input even before a store listener runs',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false);const {result}=renderHook(()=>useGameActions());
  await act(async()=>{expect(await result.current.setStance(1)).toBe(false)});expect(mock.setStance).not.toHaveBeenCalled();
 });
 it('blocks actions after reconnect until the initial subscription is ready',async()=>{
  useLoadingStore.getState().setGameDataLoaded(false);const {result}=renderHook(()=>useGameActions());
  await act(async()=>{expect(await result.current.setTarget(20,20)).toBe(false)});expect(mock.setTarget).not.toHaveBeenCalled();
 });
});
