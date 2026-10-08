import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, Mesh, Ray, Vector3 } from 'three';
import { SPAWN_TILE, SPIRE_CENTRE, tileToWorld } from '@sim';

const mock = vi.hoisted(() => ({
  me: null as any,
  enabled: false,
  treeClicks: 0,
  canvasEvents: null as any,
  focus: undefined as any,
  trees: [{ id: 1, x: 30, z: 30, kind: 0, itemId: 'blueberry', cooldownUntilTick: 0 }],
  loads: 0,
  failLoads: 0,
}));
const { stub } = vi.hoisted(() => ({ stub: (id: string) => () => <div data-testid={id} /> }));

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, events }: any) => { mock.canvasEvents = events; return <div data-testid="canvas">{children}</div>; },
  events: () => ({ priority: 1, enabled: true }),
}));
vi.mock('@react-three/drei', () => ({ PerformanceMonitor: () => null }));
vi.mock('../spacetime/hooks', () => ({
  useMyPlayer: () => mock.me, useMyPlayerSelector: (select: any) => select(mock.me),
  useGroundItems: () => [], usePlayersByHex: () => new Map(), useTick: () => 100, useTrees: () => mock.trees,
}));
vi.mock('../frontier/useFrontier', () => ({
  useFrontier: () => ({ enabled: mock.enabled, profile: { coins: 0 }, plots: [], buildings: [], resources: [] }),
  useFrontierEnabled: () => mock.enabled, useAvatarFrontier: () => undefined, FrontierSync: () => null,
}));
vi.mock('../frontier/avatarFrontierState', () => ({ avatarFrontierState: () => undefined }));
vi.mock('../frontier/WorldInteractionController', () => ({ default: () => null }));
vi.mock('../frontier/FrontierWorld', () => ({ default: stub('frontier-world'), BramblewildCreatures: stub('creatures'), FrontierScene: stub('meadows') }));
vi.mock('../frontier/HarbourApproach', () => ({ default: stub('harbour') }));
vi.mock('../Components/UIComponents', () => ({ default: () => null }));
vi.mock('../Components/CharacterSetup', () => ({ default: () => null }));
vi.mock('../Components/ClickDropdown', () => ({ default: () => null }));
vi.mock('../Components/LoadingScreen', () => ({ default: () => null }));
vi.mock('../Components/3D/webgl', () => ({ webglAvailable: () => true, webglSupport: () => 'webgl2', isWebGLError: () => false, WebGLContextWatch: () => null }));
vi.mock('../Components/3D/AlphaIsland', () => ({ default: stub('alpha-island') }));
vi.mock('../Components/3D/BerryTree', () => ({ default: () => <button data-testid="tree" onClick={() => { mock.treeClicks++; }}>Berry tree</button> }));
vi.mock('../Components/3D/nodes/CoastNode', () => ({ default: stub('coast-node') }));
vi.mock('../Components/3D/GroundItem', () => ({ default: stub('ground-item') }));
vi.mock('../Components/3D/Garden', () => ({ default: stub('garden') }));
vi.mock('../Components/3D/AdventureWorld', () => ({ default: stub('adventure-world') }));
vi.mock('../Components/3D/RenderOnlineUsers', () => ({ default: stub('avatars') }));
vi.mock('../Components/3D/PlayerController', () => ({ default: stub('player') }));
vi.mock('../Components/3D/CameraController', () => ({ default: ({ focus }: any) => { mock.focus = focus; return <div data-testid="camera" />; } }));
vi.mock('../Components/3D/HoldToWalk', () => ({ default: stub('hold-to-walk') }));
vi.mock('../Components/3D/WorldHover', () => ({ default: stub('world-hover'), WorldHoverTooltip: () => null }));
vi.mock('../Components/3D/DebugBridge', () => ({ default: stub('debug') }));
vi.mock('../fx/FxLayer', () => ({ default: stub('fx') }));
vi.mock('../bosses/clatterhorn/ClatterGlade', () => ({ default: stub('clatter-glade') }));
vi.mock('../bosses/spire/SpireGate', () => ({ default: stub('spire-gate') }));
vi.mock('../bosses/spire/loadSpireScene', () => ({ loadSpireScene: () => {
  mock.loads++;
  if (mock.failLoads > 0) { mock.failLoads--; return Promise.reject(new Error('chunk failed')); }
  return Promise.resolve({ default: () => <div data-testid="spire-scene" /> });
} }));

import GameComponent, { SPIRE_CAMERA, SPIRE_RETRY_MS } from '../Components/3D/GameComponent';
import { groundTileFromRay } from '../Components/3D/walkTarget';

const player = (x: number, z: number) => ({ identity: { toHexString: () => 'me' }, name: 'Me', region: 'bramblewild', x, z });
const OVERWORLD = ['alpha-island', 'tree', 'garden', 'adventure-world', 'clatter-glade', 'spire-gate'];
const KEPT = ['avatars', 'player', 'camera', 'hold-to-walk', 'world-hover', 'debug', 'fx'];
const down = (tile: { x: number; z: number }) => new Ray(new Vector3(...tileToWorld(tile)).add(new Vector3(0, 8, 0)), new Vector3(0, -1, 0));

afterEach(() => { cleanup(); mock.treeClicks = 0; mock.me = null; mock.enabled = false; mock.loads = 0; mock.failLoads = 0; vi.useRealTimers(); });

describe('the Spire scene swap', () => {
  it('mounts the overworld outside: a tree takes its click, the camera follows you', async () => {
    mock.me = player(SPAWN_TILE.x, SPAWN_TILE.z);
    render(<GameComponent />);
    for (const id of [...OVERWORLD, ...KEPT]) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(screen.queryByTestId('spire-scene')).not.toBeInTheDocument();
    expect(mock.focus).toBeUndefined();
    fireEvent.click(screen.getByTestId('tree'));
    expect(mock.treeClicks).toBe(1);
  });

  it('with you on the floor the overworld is unmounted, so no tree opens a menu, and the Spire scene mounts', async () => {
    mock.me = player(72, 68);
    render(<GameComponent />);
    expect(await screen.findByTestId('spire-scene')).toBeInTheDocument();
    for (const id of OVERWORLD) expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    for (const id of KEPT) expect(screen.getByTestId(id)).toBeInTheDocument();
    expect(mock.treeClicks).toBe(0);
    expect(mock.focus).toBe(SPIRE_CAMERA);
    // Menus built from a click ray now walk on the floor only.
    expect(groundTileFromRay(down({ x: 73, z: 68 }))).toEqual({ x: 73, z: 68 });
    expect(groundTileFromRay(down(SPAWN_TILE))).toBeNull();
  });

  it('remounts the overworld on the way out (the teleport row flips it)', async () => {
    mock.me = player(72, 68);
    const ui = render(<GameComponent />);
    await screen.findByTestId('spire-scene');
    mock.me = player(61, 45);
    await act(async () => { ui.rerender(<GameComponent />); });
    expect(screen.getByTestId('tree')).toBeInTheDocument();
    expect(screen.queryByTestId('spire-scene')).not.toBeInTheDocument();
    expect(mock.focus).toBeUndefined();
    expect(groundTileFromRay(down({ x: 73, z: 68 }))).toBeNull();
  });

  it('a failed Spire chunk load keeps the world mounted and retries with a fresh lazy component', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    mock.failLoads = 1;
    mock.me = player(72, 68);
    render(<GameComponent />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mock.loads).toBe(1);
    expect(screen.queryByTestId('spire-scene')).not.toBeInTheDocument();
    // WorldBoundary never saw the error: the Canvas and its avatars stay up.
    for (const id of KEPT) expect(screen.getByTestId(id)).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(SPIRE_RETRY_MS + 10); });
    expect(mock.loads).toBe(2);
    expect(screen.getByTestId('spire-scene')).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('gives the Canvas the visible-only event filter', () => {
    mock.me = player(SPAWN_TILE.x, SPAWN_TILE.z);
    render(<GameComponent />);
    const manager = mock.canvasEvents(null);
    expect(manager.priority).toBe(1);
    const hidden = new Group();
    hidden.visible = false;
    const a = new Mesh(), b = Object.assign(new Mesh(), { __r3f: { eventCount: 1 } });
    hidden.add(b);
    expect(manager.filter([{ object: a }, { object: b }], {})).toEqual([{ object: a }]);
  });

  it('frames the arena centre: world (52, 37), distance 24, zoom 18..34', () => {
    const [x, , z] = tileToWorld(SPIRE_CENTRE);
    expect(SPIRE_CAMERA).toEqual({ target: [x, z], distance: 24, min: 18, max: 34 });
    expect(SPIRE_CAMERA.target).toEqual([52, 37]);
  });

  it('keeps the whole floor in view: 24 landscape, 30 portrait, inside the clamp', async () => {
    const { focusDistance } = await vi.importActual<typeof import('../Components/3D/CameraController')>('../Components/3D/CameraController');
    expect(focusDistance(SPIRE_CAMERA, 1280, 720)).toBe(24);
    expect(focusDistance(SPIRE_CAMERA, 390, 844)).toBe(30);
    expect(focusDistance({ ...SPIRE_CAMERA, distance: 40 }, 1280, 720)).toBe(34);
  });
});

describe('embedded Meadows', () => {
    it('stays unmounted in the Grove even when the expansion is on', () => {
      mock.enabled = true;
      mock.me = player(SPAWN_TILE.x, SPAWN_TILE.z);
      render(<GameComponent />);
      expect(screen.queryByTestId('meadows')).not.toBeInTheDocument();
      expect(screen.getByTestId('harbour')).toBeInTheDocument();
      expect(screen.getByTestId('creatures')).toBeInTheDocument();
    });

    it('mounts on the harbour road and while you are in Meadows', () => {
      mock.enabled = true;
      mock.me = player(90, 25);
      const ui = render(<GameComponent />);
      expect(screen.getByTestId('meadows')).toBeInTheDocument();
      mock.me = { ...player(31, 64), region: 'settlement' };
      ui.rerender(<GameComponent />);
      expect(screen.getByTestId('meadows')).toBeInTheDocument();
    });
  });
