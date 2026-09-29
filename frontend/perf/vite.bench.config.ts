/** Headless avatar render benchmark (not part of the game build). See run-bench.mjs. */
import { defineConfig, mergeConfig } from 'vite';
import path from 'path';
import base from '../vite.config';

export default mergeConfig(base as any, defineConfig({
  root: path.resolve(__dirname, '..'),
  resolve: { alias: [{ find: /^spacetimedb\/react$/, replacement: path.resolve(__dirname, 'mockSpacetime.ts') }] },
}));
