import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'

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
export default defineConfig({
  plugins: [react(), tailwindcss(), noStoreSpaEntry],
  server: {
    host: '0.0.0.0',
    watch: {
      usePolling: true,
    },
  },
})
