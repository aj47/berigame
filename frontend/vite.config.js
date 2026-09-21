import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ fastRefresh: !process.env.VITEST })],
  resolve: {
    alias: {
      // Pure simulation code shared with the SpacetimeDB module.
      '@sim': path.resolve(__dirname, '../shared/sim'),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared')],
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
})
