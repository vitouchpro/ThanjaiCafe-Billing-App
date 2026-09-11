import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // The till must open and take payments with no network at all, so the
    // whole app shell is precached. (Plan §32)
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Product photos must precache too — without webp here the POS shows
        // broken images the moment it goes offline.
        globPatterns: ['**/*.{js,css,html,svg,woff2,webp,png,ico}'],
        // The photo set pushes the bundle past the default 2 MiB cap.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        // The till's offline shell must never be served to a customer's phone.
        // Customer routes always go to the network for a fresh document.
        navigateFallbackDenylist: [/^\/order/, /^\/kitchen/],
      },
      manifest: {
        name: 'THANJAI CAFE — Billing',
        short_name: 'THANJAI CAFE',
        description: 'Point of sale and billing for a coffee shop.',
        theme_color: '#6b3f22',
        background_color: '#f7f2ea',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})
