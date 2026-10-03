import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import HoldToWalk, { HOLD_MS, HOLD_RETARGET_MS } from '../Components/3D/HoldToWalk';
import { holdState } from '../Components/3D/tapAssist';

const mock = vi.hoisted(() => ({
  state: null as any, me: { region: 'bramblewild' }, enabled: true,
  setTarget: vi.fn(), frontier: vi.fn(),
}));
vi.mock('@react-three/fiber', () => ({ useThree: (select: any) => select(mock.state) }));
vi.mock('../spacetime/hooks', () => ({ useMyPlayer: () => mock.me }));
vi.mock('../frontier/useFrontier', () => ({ useFrontier: () => ({ enabled: mock.enabled }) }));
vi.mock('../spacetime/actions', () => ({ useGameActions: () => ({ setTarget: mock.setTarget, frontier: mock.frontier }) }));

let wrapper: HTMLDivElement, canvas: HTMLCanvasElement;
function pointAt(x: number, z: number) {
  mock.state.camera.position.set(x - 25, 12, z - 25 + 8);
  mock.state.camera.lookAt(x - 25, 0, z - 25);
  mock.state.camera.updateMatrixWorld();
}
function press(target: Element) {
  const event = new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
  vi.advanceTimersByTime(HOLD_MS);
}
beforeEach(() => {
  vi.useFakeTimers(); mock.setTarget.mockReset(); mock.frontier.mockReset();
  mock.me = { region: 'bramblewild' }; mock.enabled = true;
  wrapper = document.createElement('div'); canvas = document.createElement('canvas');
  wrapper.append(canvas); document.body.append(wrapper);
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 } as DOMRect);
  mock.state = { gl: { domElement: canvas }, camera: new PerspectiveCamera(50, 1, .1, 200), scene: new Scene(), events: { connected: wrapper } };
  holdState.active = false; holdState.suppressClickUntil = 0;
});
afterEach(() => { cleanup(); wrapper.remove(); vi.useRealTimers(); });

describe('hold navigation across the home island', () => {
  it('accepts the canvas wrapper and sends Meadows coordinates without clamping to the old island', () => {
    pointAt(69, 25); render(<HoldToWalk />); press(wrapper);
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'settlement', x: 5, z: 64 });
    expect(mock.setTarget).not.toHaveBeenCalled();
  });

  it('walks back across the same trail from Meadows', () => {
    mock.me = { region: 'settlement' }; pointAt(61, 25); render(<HoldToWalk />); press(canvas);
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'bramblewild', x: 61, z: 25 });
    expect(mock.setTarget).not.toHaveBeenCalled();
  });

  it('uses the latest district after crossing while a gesture is held', () => {
    pointAt(61, 25); const view = render(<HoldToWalk />); press(wrapper);
    expect(mock.setTarget).toHaveBeenCalledWith(61, 25);
    mock.me = { region: 'settlement' }; view.rerender(<HoldToWalk />);
    vi.advanceTimersByTime(HOLD_RETARGET_MS);
    expect(mock.frontier).toHaveBeenCalledWith({ action: 'walk', id: 'bramblewild', x: 61, z: 25 });
  });

  it.each([true, false])('does not snap open water onto the shore when expansion is %s', enabled => {
    mock.enabled = enabled; pointAt(200, 25); render(<HoldToWalk />); press(wrapper);
    expect(mock.frontier).not.toHaveBeenCalled(); expect(mock.setTarget).not.toHaveBeenCalled();
  });

  it('never starts walking from a menu button', () => {
    const button = document.createElement('button'); wrapper.append(button);
    pointAt(69, 25); render(<HoldToWalk />); press(button);
    expect(holdState.active).toBe(false);
    expect(mock.frontier).not.toHaveBeenCalled(); expect(mock.setTarget).not.toHaveBeenCalled();
  });

  it('suppresses the release after a long hold has already triggered a resource action', () => {
    pointAt(69, 25);
    const resource = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    resource.position.set(44, 0, 0);
    const gather = vi.fn();
    const handler = () => { if (!holdState.active && performance.now() >= holdState.suppressClickUntil) gather(); };
    (resource as any).__r3f = { handlers: { onClick: handler } };
    resource.userData.hoverTarget = { title: 'Timber', action: 'Gather', click: 'action' };
    mock.state.scene.add(resource); mock.state.scene.updateMatrixWorld(true);
    render(<HoldToWalk />); press(wrapper);
    expect(gather).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1200);
    const release = new MouseEvent('pointerup', { bubbles: true });
    Object.defineProperty(release, 'pointerId', { value: 1 });
    wrapper.dispatchEvent(release);
    handler(); // R3F emits the release's click after pointerup.
    expect(gather).toHaveBeenCalledTimes(1);
    expect(mock.frontier).not.toHaveBeenCalled(); expect(mock.setTarget).not.toHaveBeenCalled();
  });

  it('marks long presses as menu requests even when one-click attacks are available', () => {
    pointAt(69, 25);
    const giant = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
    giant.position.set(44, 0, 0);
    const handler = vi.fn();
    (giant as any).__r3f = { handlers: { onClick: handler } };
    giant.userData.hoverTarget = { title: 'The Giant', action: 'Attack', click: 'action' };
    mock.state.scene.add(giant); mock.state.scene.updateMatrixWorld(true);
    render(<HoldToWalk />); press(wrapper);
    expect(handler).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ interaction: 'menu' }));
    expect(mock.frontier).not.toHaveBeenCalled(); expect(mock.setTarget).not.toHaveBeenCalled();
  });
});
