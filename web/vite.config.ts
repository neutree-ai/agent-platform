import fs from 'node:fs'
import path from 'node:path'
import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import remarkGfm from 'remark-gfm'
import { type Plugin, defineConfig, loadEnv } from 'vite'

/**
 * Local plugin dev shortcut. Set `NAP_DEV_PLUGINS_DIR` to a folder whose
 * subdirectories follow the convention `<id>/dist/<id>.js`. The middleware
 * exposes `/dev-plugins/manifest.json` (scanned at request time) and serves
 * each bundle from disk, so `vite build --watch` in a plugin folder is the
 * full dev loop — no localStorage, no publish round-trip.
 */
function devPluginsMiddleware(): Plugin {
  return {
    name: 'tos-dev-plugins',
    apply: 'serve',
    configureServer(server) {
      const root = process.env.NAP_DEV_PLUGINS_DIR
      if (!root) return
      const absRoot = path.resolve(root)

      server.middlewares.use('/dev-plugins/manifest.json', (_req, res) => {
        try {
          const entries = fs.existsSync(absRoot)
            ? fs
                .readdirSync(absRoot, { withFileTypes: true })
                .filter((e) => e.isDirectory())
                .map((e) => ({
                  id: e.name,
                  bundlePath: path.join(absRoot, e.name, 'dist', `${e.name}.js`),
                }))
                .filter((e) => fs.existsSync(e.bundlePath))
                .map((e) => ({
                  id: e.id,
                  version: 'dev',
                  bundleUrl: `/dev-plugins/${e.id}/${e.id}.js`,
                }))
            : []
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(JSON.stringify(entries))
        } catch (err) {
          res.statusCode = 500
          res.end(String(err))
        }
      })

      server.middlewares.use('/dev-plugins/', (req, res, next) => {
        if (!req.url) return next()
        const rel = req.url.split('?')[0].replace(/^\/+/, '')
        // expected: <id>/dist/<id>.js  →  resolve under <absRoot>/<id>/dist/<id>.js
        const parts = rel.split('/')
        if (parts.length < 2) return next()
        const id = parts[0]
        const file = path.join(absRoot, id, 'dist', parts.slice(1).join('/'))
        if (!file.startsWith(absRoot) || !fs.existsSync(file)) return next()
        res.setHeader('Content-Type', 'application/javascript')
        res.setHeader('Cache-Control', 'no-cache')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_BACKEND_URL || 'http://localhost:3000'

  return {
    // @extend-ai/react-xlsx ships a Web Worker that code-splits; Rollup
    // rejects the default iife worker format for code-splitting builds, so
    // emit workers as ES modules.
    worker: { format: 'es' },
    plugins: [
      {
        enforce: 'pre',
        ...mdx({ remarkPlugins: [remarkGfm], mdxExtensions: ['.mdx'], include: /\.mdx$/ }),
      },
      react(),
      devPluginsMiddleware(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@neutree-ai/types': path.resolve(__dirname, '../internal/types/index.ts'),
        '@neutree-ai/sse-consumer': path.resolve(
          __dirname,
          '../internal/sse-consumer/src/index.ts',
        ),
        '@neutree-ai/theme/variables.css': path.resolve(
          __dirname,
          '../internal/theme/src/variables.css',
        ),
        '@neutree-ai/theme': path.resolve(__dirname, '../internal/theme/src/index.ts'),
        '@neutree-ai/ui-sdk': path.resolve(__dirname, '../internal/ui-sdk/src/index.ts'),
      },
      // @neutree-ai/ui-sdk (aliased to source) ships its own copies of these
      // packages under internal/ui-sdk/node_modules. Radix primitives use
      // module-scoped React contexts, so a second instance means a <Tooltip>
      // from ui-sdk's MessageBubble can't see the app-root <TooltipProvider>
      // (web's instance) → "Tooltip must be used within TooltipProvider".
      // Dedupe forces a single instance across web + ui-sdk (same as React).
      dedupe: [
        'react',
        'react-dom',
        'sonner',
        'lucide-react',
        'react-i18next',
        'i18next',
        '@radix-ui/react-tooltip',
        '@radix-ui/react-collapsible',
        '@radix-ui/react-slot',
      ],
    },
    server: {
      host: '0.0.0.0',
      port: 15173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          ws: true,
        },
        '/_cp': {
          target,
          changeOrigin: true,
        },
        '/_cg': {
          target,
          changeOrigin: true,
        },
        '/_proxy': {
          target,
          changeOrigin: true,
          ws: true,
        },
        '/_saas': {
          target,
          changeOrigin: true,
        },
      },
    },
  }
})
