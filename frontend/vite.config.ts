import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,   // listen on all network interfaces, not just localhost
    proxy: {
      // Proxy all /api calls to ASP.NET Core backend
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      // Proxy SignalR hub
      '/hubs': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true, // WebSocket support
      }
    }
  }
})
