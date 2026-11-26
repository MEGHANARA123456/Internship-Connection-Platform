import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const noStoreSpaEntry: Plugin = {
  name: 'no-store-spa-entry',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split('?', 1)[0]
      if (pathname === '/' || pathname === '/index.html') {
        response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      }
      next()
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split('?', 1)[0]
      if (pathname === '/' || pathname === '/index.html') {
        response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
      }
      next()
    })
  },
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const apiUrl = env.VITE_API_URL?.trim()
  if (mode === 'production' && !apiUrl) {
    throw new Error('VITE_API_URL is required for production builds.')
  }
  let apiTarget: string | undefined
  if (apiUrl) {
    try {
      apiTarget = new URL(apiUrl).origin
    } catch {
      throw new Error('VITE_API_URL must be an absolute URL when set.')
    }
  }

  return {
    plugins: [react(), tailwindcss(), noStoreSpaEntry],
    server: {
      host: '0.0.0.0',
      watch: {
        usePolling: true,
      },
      ...(apiTarget
        ? { proxy: { '/api/v1': { target: apiTarget, changeOrigin: true, ws: true } } }
        : {}),
    },
  }
})
