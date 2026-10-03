import type CameraControls from 'camera-controls';
import { isWorldSurface } from './hoverTarget';

/** Preserve the library's zoom/touch mappings while reserving left clicks for play. */
export function configureWorldCameraInput(controls: CameraControls) {
  const { ACTION } = controls.constructor as typeof CameraControls;
  controls.mouseButtons.left = ACTION.NONE;
  controls.mouseButtons.right = ACTION.ROTATE;
}

/** Right-button gestures belong to the camera, including their browser release events. */
export function guardWorldCameraClicks(canvas: HTMLCanvasElement, connected?: EventTarget) {
  const secondary = (event: MouseEvent) => {
    if (event.button === 0 || !isWorldSurface(event.target, canvas, connected)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const context = (event: MouseEvent) => {
    if (isWorldSurface(event.target, canvas, connected)) event.preventDefault();
  };
  window.addEventListener('click', secondary, true);
  window.addEventListener('auxclick', secondary, true);
  window.addEventListener('contextmenu', context, true);
  return () => {
    window.removeEventListener('click', secondary, true);
    window.removeEventListener('auxclick', secondary, true);
    window.removeEventListener('contextmenu', context, true);
  };
}
