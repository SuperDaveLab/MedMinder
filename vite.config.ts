import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.1.0'),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['med-minder-icon.svg', 'screenshot-care.svg', 'screenshot-admin.svg'],
      manifest: {
        id: '/',
        name: 'Med-Minder Care Tracker',
        short_name: 'Med-Minder',
        description: 'Local-first medication timing tracker for caregivers.',
        theme_color: '#0f766e',
        background_color: '#f4f7f9',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui', 'browser'],
        orientation: 'portrait',
        scope: '/',
        start_url: '/?view=care',
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
        screenshots: [
          {
            src: 'screenshot-care.svg',
            sizes: '720x1280',
            type: 'image/svg+xml',
            label: 'Care view with medication eligibility and dose actions',
            form_factor: 'narrow',
          },
          {
            src: 'screenshot-admin.svg',
            sizes: '720x1280',
            type: 'image/svg+xml',
            label: 'Admin view for patient, medication, and backup management',
            form_factor: 'narrow',
          },
        ],
        shortcuts: [
          {
            name: 'Care',
            short_name: 'Care',
            description: 'Open current medication eligibility and dose actions',
            url: '/?view=care',
            icons: [{ src: 'med-minder-icon.svg', sizes: '192x192', type: 'image/svg+xml' }],
          },
          {
            name: 'History',
            short_name: 'History',
            description: 'Review all dose history and corrections',
            url: '/?view=history',
            icons: [{ src: 'med-minder-icon.svg', sizes: '192x192', type: 'image/svg+xml' }],
          },
          {
            name: 'Admin',
            short_name: 'Admin',
            description: 'Manage patient and medication records',
            url: '/?view=admin',
            icons: [{ src: 'med-minder-icon.svg', sizes: '192x192', type: 'image/svg+xml' }],
          },
          {
            name: 'Summary',
            short_name: 'Summary',
            description: 'Open printable patient medication summary',
            url: '/?view=summary',
            icons: [{ src: 'med-minder-icon.svg', sizes: '192x192', type: 'image/svg+xml' }],
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
