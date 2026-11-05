import { DataTexture, LinearFilter, RGBAFormat } from 'three';
import { HOME_GRID, MEADOW_OFFSET } from '../../../shared/sim/frontier/homeMap';
import { homeFieldSamples } from './homeMapArt';
/**
 * Same coastal shading along both districts, including the walking seam: one
 * texel per tile (linear filtering smooths it), from the field samples the map
 * already takes, so the joined 384-wide frame is sampled once.
 */
export const homeCoastTexture = (() => {
  const { samples, width: stride, x0, z0 } = homeFieldSamples();
  const width = HOME_GRID.width, height = HOME_GRID.height, data = new Uint8Array(width * height * 4);
  for (let z = 0; z < height; z++) for (let x = 0; x < width; x++) {
    const field = samples[(z + MEADOW_OFFSET.z - z0) * stride + x - x0];
    const i = (z * width + x) * 4, value = Math.round(Math.max(0, Math.min(1, (8 - field) / 32)) * 255);
    data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
  }
  const t = new DataTexture(data, width, height, RGBAFormat); t.minFilter = LinearFilter; t.magFilter = LinearFilter; t.needsUpdate = true; return t;
})();
