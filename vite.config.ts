import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['med-minder-icon.svg'],
      manifest: {
        name: 'Med-Minder',
        short_name: 'MedMinder',
        description: 'Local-first medication timing tracker.',
        theme_color: '#0f766e',
        background_color: '#f4f7f9',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'med-minder-icon.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: 'med-minder-icon.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/engine/**/*.ts', 'src/domain/**/*.ts'],
    },
  },
})
