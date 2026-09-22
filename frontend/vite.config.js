import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFile } from 'node:fs/promises'
import { configDefaults } from 'vitest/config'

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

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({ fastRefresh: !process.env.VITEST }), agentGuide()],
  resolve: {
    alias: {
      // Pure simulation code shared with the SpacetimeDB module.
      '@sim': path.resolve(__dirname, '../shared/sim'),
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
