import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useLoadingStore } from '../../store';

/** Probe once with a throwaway canvas; blocklisted GPUs return no context. */
export function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
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
