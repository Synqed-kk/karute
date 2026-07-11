import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Approach B — separate thin target. Imports the REAL customer-profile client
// components from src/ and renders them standalone. Alias `@` → src so the
// component tree resolves against the app's own modules; the two Next-only
// seams (server actions, next-intl navigation) are redirected to local stubs.
const root = path.resolve(__dirname, '..')

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: [
      // Order matters: specific stubs BEFORE the catch-all `@` → src.
      { find: '@/actions/customers', replacement: path.resolve(__dirname, 'stubs/actions.ts') },
      { find: '@/actions/packs', replacement: path.resolve(__dirname, 'stubs/actions.ts') },
      { find: '@/actions/memory', replacement: path.resolve(__dirname, 'stubs/actions.ts') },
      { find: '@/actions/regenerate-karute', replacement: path.resolve(__dirname, 'stubs/actions.ts') },
      { find: '@/i18n/navigation', replacement: path.resolve(__dirname, 'stubs/navigation.tsx') },
      { find: 'next/navigation', replacement: path.resolve(__dirname, 'stubs/navigation.tsx') },
      { find: /^@\/(.*)/, replacement: path.resolve(root, 'src') + '/$1' },
    ],
  },
  css: {
    // Tailwind v4 lives in the repo-root postcss config; Vite's root is spike/.
    postcss: root,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
})
