import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GiantState } from '@sim';

const mock = vi.hoisted(() => ({ players: [] as any[], me: 'me' }));
vi.mock('../spacetime/hooks', () => ({
  usePlayers: () => mock.players, useMyIdentityHex: () => mock.me, useMyPlayer: () => mock.players.find((p) => p.identity.toHexString() === mock.me),
  useChatMessages: () => [], useTick: () => 100, useAppearanceRows: () => [], useTrainingDummies: () => [{ id: 1, lastHitTick: 0 }],
  useGiants: () => [{ id: 1, state: GiantState.Idle, respawnTick: 0, lastHitTick: 0 }],
}));
vi.mock('../Components/3D/PlayerAvatar', () => ({ default: ({ row }: any) => <div data-testid={`avatar-${row.identity.toHexString()}`} /> }));
vi.mock('../Components/3D/AvatarDecals', () => ({ default: () => null }));
vi.mock('../Components/3D/AvatarOverlay', () => ({ AvatarOverlay: () => null }));
vi.mock('../Components/3D/AnimationCulling', () => ({ default: () => null }));
vi.mock('../Components/3D/TrainingDummy', () => ({ default: () => <div data-testid="dummy" /> }));
vi.mock('../Components/3D/Giant', () => ({ default: () => <div data-testid="giant" /> }));
vi.mock('../Components/3D/DeathBagMarker', () => ({ default: () => null, CameraLookProbe: () => null }));
vi.mock('../bosses/clatterhorn/Clatterhorn', () => ({ default: () => <div data-testid="clatterhorn" /> }));

import RenderOnlineUsers from '../Components/3D/RenderOnlineUsers';
import { useBossStore } from '../bosses/bossStore';

const p = (hex: string, x: number, z: number) => ({ identity: { toHexString: () => hex }, name: hex, online: true, region: 'bramblewild', x, z, facing: 0, state: 0, hostile: false });
const avatars = () => screen.queryAllByTestId(/^avatar-/).map((e) => e.dataset.testid!.slice(7)).sort();

afterEach(() => { cleanup(); useBossStore.getState().reset(); });

describe('avatars under the Spire\'s logical instancing', () => {
  it('outside: nobody on the floor is drawn; the Giant, dummies and Clatterhorn are', () => {
    mock.players = [p('me', 61, 45), p('walker', 60, 45), p('diver', 72, 68)];
    render(<RenderOnlineUsers />);
    expect(avatars()).toEqual(['walker']);
    for (const id of ['giant', 'dummy', 'clatterhorn']) expect(screen.getByTestId(id)).toBeInTheDocument();
  });

  it('inside: only your own run; the overworld bosses and dummies are skipped', () => {
    mock.players = [p('me', 72, 68), p('mate', 73, 68), p('stranger', 75, 68), p('walker', 60, 45)];
    act(() => useBossStore.setState({ myRunHexes: new Set(['me', 'mate']) }));
    render(<RenderOnlineUsers />);
    expect(avatars()).toEqual(['mate']);
    for (const id of ['giant', 'dummy', 'clatterhorn']) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
  });
});

describe('i-frame blink timing', () => {
  it('reads your run\'s hitTick for the member slot and blinks for the hit tick plus two', async () => {
    const { spireHitTick, inIframes } = await vi.importActual<typeof import('../Components/3D/PlayerAvatar')>('../Components/3D/PlayerAvatar');
    const members = new Map([['mate', { runId: 7n, slot: 2 }], ['ghost', { runId: 9n, slot: 0 }]]) as any;
    const fights = new Map([['7', { runId: 7n, hitTick0: 0, hitTick1: 0, hitTick2: 140, hitTick3: 0 }]]) as any;
    expect(spireHitTick({ members, fights }, 'mate')).toBe(140);
    expect(spireHitTick({ members, fights }, 'ghost')).toBe(0);
    expect(spireHitTick({ members, fights }, 'nobody')).toBe(0);
    expect([139, 140, 141, 142, 143].map((t) => inIframes(140, t))).toEqual([false, true, true, true, false]);
    expect(inIframes(0, 1)).toBe(false);
  });
});
