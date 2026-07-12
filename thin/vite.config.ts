import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Production thin target (PLAN §3, DECIDED = separate thin target). Imports the
// REAL shared components from src/ and renders them standalone. The boundary is
// enforced by ALIASES that redirect the Next-only seams to platform-neutral port
// implementations — production code, NOT the spike's inert stubs:
//   • @/actions/*        → loud-failing facade proxy (BFF pending; never no-ops)
//   • next/navigation    → History-API client router (NavPort vite impl)
//   • @/i18n/navigation   → same client router
//   • purchase surfaces  → null renders (import-level exclusion, §1.5 canon)
//   • @/*                → src (single source of truth; shared UI is NOT copied)
const root = path.resolve(__dirname, '..')
const port = (p: string) => path.resolve(__dirname, 'ports', p)

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: [
      // Order matters: specific aliases BEFORE the catch-all `@` → src.
      // Boundary seams → real port implementations.
      { find: '@/actions/customers', replacement: port('actions.vite.ts') },
      { find: '@/actions/packs', replacement: port('actions.vite.ts') },
      { find: '@/actions/memory', replacement: port('actions.vite.ts') },
      { find: '@/actions/regenerate-karute', replacement: port('actions.vite.ts') },
      { find: '@/i18n/navigation', replacement: port('nav.vite.tsx') },
      { find: 'next/navigation', replacement: port('nav.vite.tsx') },
      // Payments canon: purchase surfaces never enter the bundle (build #7).
      {
        find: '@/components/settings/redesign/sections/subscription/PlanComparisonGrid',
        replacement: port('purchase-excluded.tsx'),
      },
      {
        find: '@/components/settings/redesign/sections/subscription/CancelConfirmDialog',
        replacement: port('purchase-excluded.tsx'),
      },
      {
        find: '@/components/settings/redesign/sections/subscription/PaymentUpdateDialog',
        replacement: port('purchase-excluded.tsx'),
      },
      // Catch-all: everything else resolves against the app's own modules.
      { find: /^@\/(.*)/, replacement: path.resolve(root, 'src') + '/$1' },
    ],
  },
  css: {
    // Tailwind v4 lives in the repo-root postcss config; Vite's root is thin/.
    postcss: root,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // Split the vendor runtime into its own cached chunk. Per-ROUTE lazy chunks
    // land with the router (screen-conversion volume); this proves splitting is
    // wired and keeps the React/vendor payload out of the app chunk.
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          id.includes('node_modules') ? 'vendor' : undefined,
      },
    },
  },
})
