import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useLoadingStore } from '../../store';

/**
 * Probe once with throwaway canvases. three.js renders with WebGL 2 only (since r163);
 * 'webgl1' means the browser or device is too old to play, null that the GPU is
 * blocklisted or graphics acceleration is off.
 */
export function webglSupport(): 'webgl2' | 'webgl1' | null {
  try {
    const probe = (kind: 'webgl2' | 'webgl') => {
      const gl = document.createElement('canvas').getContext(kind) as WebGLRenderingContext | null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      return !!gl;
    };
    if (probe('webgl2')) return 'webgl2';
    return probe('webgl') ? 'webgl1' : null;
  } catch {
    return null;
  }
}

/** Whether the world renderer can start. */
export function webglAvailable(): boolean {
  return webglSupport() === 'webgl2';
}

/** Renderer construction errors that mean the browser refused WebGL. */
export function isWebGLError(error: unknown): boolean {
  return /webgl/i.test(String((error as Error)?.message ?? error));
}

/** Lost contexts that stay lost show recovery steps; a quick restore stays silent. */
export function watchWebGLContext(canvas: HTMLCanvasElement, graceMs = 2000) {
  let timer = 0;
  const lost = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => useLoadingStore.getState().setGraphicsIssue('lost'), graceMs);
  };
  const restored = () => {
    window.clearTimeout(timer);
    if (useLoadingStore.getState().graphicsIssue === 'lost') useLoadingStore.getState().setGraphicsIssue(null);
  };
  canvas.addEventListener('webglcontextlost', lost);
  canvas.addEventListener('webglcontextrestored', restored);
  return () => {
    window.clearTimeout(timer);
    canvas.removeEventListener('webglcontextlost', lost);
    canvas.removeEventListener('webglcontextrestored', restored);
  };
}

/** Mount inside a Canvas. Unmount detaches first, so R3F's own forceContextLoss is ignored. */
export function WebGLContextWatch() {
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => watchWebGLContext(canvas), [canvas]);
  return null;
}
