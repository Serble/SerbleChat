import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Electron loads dist/index.html over file://, so it needs relative asset paths.
  // The web build must use absolute paths, otherwise deep links like /app/channel/1
  // resolve assets to /app/channel/assets/... and get the SPA fallback HTML instead.
  base: mode === 'electron' ? './' : '/',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}));
