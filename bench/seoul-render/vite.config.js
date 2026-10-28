import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/tiles': { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: false }
    }
  }
});
