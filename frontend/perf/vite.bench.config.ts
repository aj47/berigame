/** Headless avatar render benchmark (not part of the game build). See run-bench.mjs.
 * Production build: npx vite build --config perf/vite.bench.config.ts && npx vite preview --config perf/vite.bench.config.ts --port 6010
 */
import { defineConfig, mergeConfig } from 'vite';
import path from 'path';
import base from '../vite.config';

export default mergeConfig(base as any, defineConfig({
  root: path.resolve(__dirname, '..'),
  resolve: { alias: [{ find: /^spacetimedb\/react$/, replacement: path.resolve(__dirname, 'mockSpacetime.ts') }] },
  build: { outDir: 'dist/bench', rollupOptions: { input: { bench: path.resolve(__dirname, 'avatar-bench.html') } } },
}));
