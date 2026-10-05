import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { configureWorldCameraInput, guardWorldCameraClicks } from '../Components/3D/cameraInput';

CameraControls.install({ THREE });
let wrapper: HTMLDivElement, canvas: HTMLCanvasElement, controls: CameraControls, detach: () => void;
function pointer(target: EventTarget, type: string, x: number, button = 0, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, buttons: type === 'pointerup' ? 0 : button === 2 ? 2 : 1, clientX: x, clientY: 100 });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  target.dispatchEvent(event);
}
function drag(button: number, pointerType = 'mouse') {
  pointer(wrapper, 'pointerdown', 100, button, pointerType);
  pointer(document, 'pointermove', 160, button, pointerType);
  controls.update(1);
  pointer(document, 'pointerup', 160, button, pointerType);
}
beforeEach(() => {
  wrapper = document.createElement('div'); canvas = document.createElement('canvas');
  wrapper.append(canvas); document.body.append(wrapper);
  wrapper.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 } as DOMRect);
  const camera = new THREE.PerspectiveCamera(50, 4 / 3, .1, 100);
  camera.position.set(0, 10, 18); camera.lookAt(0, 0, 0);
  controls = new CameraControls(camera, wrapper);
  configureWorldCameraInput(controls);
  controls.update(1);
  detach = guardWorldCameraClicks(canvas, wrapper);
});
afterEach(() => { detach(); controls.dispose(); wrapper.remove(); });

describe('world camera controls', () => {
  it('rotates with right drag while left drag leaves the view still', () => {
    const start = controls.azimuthAngle;
    drag(0); expect(controls.azimuthAngle).toBe(start);
    drag(2); expect(Math.abs(controls.azimuthAngle - start)).toBeGreaterThan(.1);
  });

  it('preserves touch drag and multi-touch zoom mappings', () => {
    expect(controls.touches.two).toBe(CameraControls.ACTION.TOUCH_DOLLY_TRUCK);
    const start = controls.azimuthAngle;
    drag(0, 'touch'); expect(Math.abs(controls.azimuthAngle - start)).toBeGreaterThan(.1);
  });

  it('preserves scroll and middle-button zoom', () => {
    expect(controls.mouseButtons.middle).toBe(CameraControls.ACTION.DOLLY);
    const start = controls.distance;
    wrapper.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: 100, clientY: 100 }));
    controls.update(1);
    expect(controls.distance).not.toBe(start);
  });

  it.each(['click', 'auxclick'])('consumes right-button %s without reaching world gameplay handlers', type => {
    const gameplay = vi.fn(); wrapper.addEventListener(type, gameplay);
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(gameplay).not.toHaveBeenCalled();
  });

  it('leaves primary world clicks available for gameplay', () => {
    const gameplay = vi.fn(); wrapper.addEventListener('click', gameplay);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(gameplay).toHaveBeenCalledOnce();
  });

  it('suppresses browser menus on the world even while a hold pauses camera controls', () => {
    controls.enabled = false;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    wrapper.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not consume clicks or native menus on interface controls', () => {
    const button = document.createElement('button'); document.body.append(button);
    for (const type of ['click', 'auxclick', 'contextmenu']) {
      const listener = vi.fn(); button.addEventListener(type, listener);
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 2 });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false); expect(listener).toHaveBeenCalledOnce();
    }
    button.remove();
  });
});

describe('left-drag camera preference', () => {
  it('rotates with left or right drag when left rotation is chosen', () => {
    configureWorldCameraInput(controls, 'left');
    let start = controls.azimuthAngle;
    drag(0); expect(Math.abs(controls.azimuthAngle - start)).toBeGreaterThan(.1);
    start = controls.azimuthAngle;
    drag(2); expect(Math.abs(controls.azimuthAngle - start)).toBeGreaterThan(.1);
    configureWorldCameraInput(controls, 'right');
    expect(controls.mouseButtons.left).toBe(CameraControls.ACTION.NONE);
  });
});
