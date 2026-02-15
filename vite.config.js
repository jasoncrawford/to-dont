import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { copyFileSync } from 'fs';
import { resolve } from 'path';

// Files that aren't part of the Vite module graph but need to be in dist/
const staticAssets = ['styles.css'];

function copyStaticAssets() {
  return {
    name: 'copy-static-assets',
    writeBundle(options) {
      const outDir = options.dir || 'dist';
      for (const file of staticAssets) {
        const src = resolve(__dirname, file);
        const dest = resolve(outDir, file);
        try {
          copyFileSync(src, dest);
        } catch (e) {
          console.warn(`Warning: could not copy ${file}: ${e.message}`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    copyStaticAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
      },
      manifest: {
        name: "To-Don't",
        short_name: "To-Don't",
        description: 'A minimalist to-do list where undone items fade away',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  define: {
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL || ''),
    __SUPABASE_ANON_KEY__: JSON.stringify(process.env.SUPABASE_ANON_KEY || ''),
    __SYNC_BEARER_TOKEN__: JSON.stringify(process.env.SYNC_BEARER_TOKEN || ''),
    __SUPABASE_SCHEMA__: JSON.stringify(process.env.SUPABASE_SCHEMA || 'public'),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
