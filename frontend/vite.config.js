import { createLogger, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFile } from 'node:fs/promises'
import { configDefaults } from 'vitest/config'
import { wikiAssets } from './scripts/wiki-assets.mjs'

// Serve the machine-readable guide inline in browsers as well as HTTP clients.
function agentGuide() {
  const configure = server => {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split('?')[0] !== '/agent.md' || !['GET', 'HEAD'].includes(req.method)) return next()
      readFile(path.resolve(__dirname, 'public/agent.md')).then(body => {
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader('Content-Length', body.length)
        res.end(req.method === 'HEAD' ? undefined : body)
      }).catch(next)
    })
  }
  return { name: 'agent-guide', configureServer: configure, configurePreviewServer: configure }
}

// Pre-bundled dependencies' maps leave their sources out (optimizeDeps below); Vite
// notes each source it then declines to copy in from another package. Drop that note.
const logger = createLogger()
const warnOnce = logger.warnOnce.bind(logger)
logger.warnOnce = (msg, options) => { if (!msg.includes('points to a source file outside its package')) warnOnce(msg, options) }

// https://vitejs.dev/config/
export default defineConfig({
  customLogger: logger,
  plugins: [react({ fastRefresh: !process.env.VITEST }), agentGuide(), wikiAssets()],
  optimizeDeps: {
    // Auxiliary art-preview HTML files are not application entry points.
    entries: ['index.html'],
    // The dev server inlines pre-bundled dependencies' source maps. Without the sources
    // copied into each map, three's file stays well under the browser's in-memory cache
    // entry limit, so a reload reuses it instead of downloading it again.
    rolldownOptions: { output: { sourcemapExcludeSources: true } },
  },
  resolve: {
    alias: [
      // Pure simulation code shared with the SpacetimeDB module.
      { find: '@sim', replacement: path.resolve(__dirname, '../shared/sim') },
      // Only the drei helpers the game uses (src/vendor/drei.ts); deep imports pass through.
      { find: /^@react-three\/drei$/, replacement: path.resolve(__dirname, 'src/vendor/drei.ts') },
    ],
  },
  build: {
    // Vite 4's default browser floor. Vite 8's own (Safari 16.4, Chrome 111) leaves three's class
    // static blocks and CSS range media queries in the output, so older Safari and Chrome would
    // fail to parse the 3D chunks and ignore every mobile breakpoint.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    rollupOptions: {
      output: {
        // three.js (half the bundle, no dependencies of its own) changes far less
        // often than the game: its own chunk stays cached across deploys and
        // downloads in parallel with the entry (modulepreload).
        manualChunks(id) {
          if (/node_modules\/three\//.test(id)) return 'three'
          return undefined
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/agent': { target: process.env.BERIGAME_AGENT_API_ORIGIN ?? 'http://127.0.0.1:3001', changeOrigin: true },
    },
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared')],
    },
  },
  test: {
    exclude: [...configDefaults.exclude, 'agent-api/**'],
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
})
