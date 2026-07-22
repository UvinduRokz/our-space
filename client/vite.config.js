import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': BACKEND,
      '/music': BACKEND,
      '/drawings': BACKEND,
      '/cursors': BACKEND,
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
})
