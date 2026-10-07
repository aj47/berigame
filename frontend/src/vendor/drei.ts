/**
 * The drei helpers the game uses, imported from their own modules. vite.config.js
 * aliases '@react-three/drei' here: the full barrel (hundreds of helpers plus
 * hls.js and MediaPipe) pre-bundles in development to an 11 MB file, too big for
 * the browser's in-memory cache, so every reload downloaded it again. Add a
 * helper here before importing it from '@react-three/drei'.
 */
export { Html } from '@react-three/drei/web/Html.js';
export { useGLTF } from '@react-three/drei/core/Gltf.js';
export { OrbitControls } from '@react-three/drei/core/OrbitControls.js';
export { CameraControls } from '@react-three/drei/core/CameraControls.js';
export { PerformanceMonitor } from '@react-three/drei/core/PerformanceMonitor.js';
export { useTexture } from '@react-three/drei/core/Texture.js';
