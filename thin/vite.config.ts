import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// Production thin target (PLAN §3, DECIDED = separate thin target). Imports the
// REAL shared components from src/ and renders them standalone.
//
// The boundary is enforced in TWO layers:
//   1. Specifier ALIASES for bare module names (next/navigation, next/link,
//      @/i18n/navigation) — these can only be reached by their specifier, so an
//      alias is sufficient and also rewrites node_modules importers (next-intl).
//   2. A resolveId PLUGIN that judges RESOLVED ABSOLUTE PATHS (below) — the only
//      way to catch relative imports (`./stores/AddStoreSubscriptionDialog`) and
//      to cover ALL of src/actions/** without maintaining a per-module list.
//      Fable review round 1: the previous per-specifier action aliases covered 4
//      of 16 modules; the other 12 resolved to REAL 'use server' files via the
//      @/ catch-all with no error.
const root = path.resolve(__dirname, '..')
const port = (p: string) => path.resolve(__dirname, 'ports', p)

const ACTIONS_DIR = path.resolve(root, 'src/actions') + path.sep
const ACTIONS_PORT = port('actions.vite.ts')
const PURCHASE_PORT = port('purchase-excluded.tsx')

// Payments-canon denylist (§1.5): purchase-surface FILES that must never enter
// the bundle. Judged by resolved path, so relative imports are caught too.
// Names must also exist in thin/ports/purchase-excluded.tsx.
const PURCHASE_FILES = new Set(
  [
    'src/components/settings/redesign/sections/subscription/PlanComparisonGrid.tsx',
    'src/components/settings/redesign/sections/subscription/CancelConfirmDialog.tsx',
    'src/components/settings/redesign/sections/subscription/PaymentUpdateDialog.tsx',
    'src/components/settings/redesign/sections/stores/AddStoreSubscriptionDialog.tsx',
    'src/components/settings/redesign/sections/stores/PlanComparisonDialog.tsx',
  ].map((p) => path.resolve(root, p)),
)

// Vendor-side §1.5 hole: @synqed-kk/ui ships its own purchase components and has
// no `sideEffects` field, so its index re-exports (top-level displayName
// assignments) survive tree-shaking even though nothing imports them. Matched by
// path SUFFIX — rollup resolves through symlinked/hoisted node_modules layouts,
// so absolute paths can't be trusted here. check-bundle-budget.mjs greps the
// built output as the backstop if the package layout moves.
const PURCHASE_VENDOR_SUFFIXES = [
  '/@synqed-kk/ui/dist/components/plan-comparison-grid.js',
  '/@synqed-kk/ui/dist/components/subscription-summary-card.js',
]

// next/navigation + next/link are handled by alias BEFORE this plugin runs
// (Vite applies resolve.alias first), so any `next/*` specifier that reaches
// the plugin from OUR code is unported.
function boundaryPlugin(): Plugin {
  return {
    name: 'karute-thin-boundary',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null

      // (c) Unported Next API adopted by a shared module → LOUD build failure
      // naming the importer (next/cache, next/headers, next/image, …).
      // node_modules importers are exempt: their next/* usage is not ours to
      // police, and the nav alias already rewrites the ones we port.
      if (source.startsWith('next/') && !importer.includes('node_modules')) {
        throw new Error(
          `[thin boundary] "${source}" imported by ${importer} has no thin-target port. ` +
            'Ported: next/navigation, next/link (→ thin/ports/nav.vite.tsx). ' +
            'Anything else needs a platform-neutral port before it can ship in the bundle.',
        )
      }

      // Resolve to an absolute file path, then judge the PATH. Forward the
      // rollup options (attributes/custom) — required for commonjs/node-resolve.
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      })
      if (!resolved) return null

      // (a) ANY module under src/actions/** → the loud facade proxy. Missing
      // named exports then fail the build per-name — correct and desired; names
      // are added to actions.vite.ts as screens convert.
      if (resolved.id.startsWith(ACTIONS_DIR)) return ACTIONS_PORT

      // (b) Purchase surfaces → null renders, whatever the import shape.
      if (PURCHASE_FILES.has(resolved.id)) return PURCHASE_PORT
      if (PURCHASE_VENDOR_SUFFIXES.some((s) => resolved.id.endsWith(s))) return PURCHASE_PORT

      return null
    },
  }
}

export default defineConfig({
  root: __dirname,
  // Web-app modules read process.env.NEXT_PUBLIC_* FLAGS at module scope
  // (DetailBreadcrumb, PhotoRecordsCard); the browser has no `process` and the
  // import crashes the whole screen (Greptile P1 on #494). Substitute an empty
  // env: every NEXT_PUBLIC_FEATURE_* flag reads undefined → features default
  // OFF in thin, which is the wanted posture.
  define: { 'process.env': '{}' },
  plugins: [boundaryPlugin(), react()],
  resolve: {
    alias: [
      // Bare-specifier seams (applied before plugins; also rewrites node_modules
      // importers like next-intl's own next/navigation import).
      { find: '@/i18n/navigation', replacement: port('nav.vite.tsx') },
      { find: 'next/navigation', replacement: port('nav.vite.tsx') },
      { find: 'next/link', replacement: port('nav.vite.tsx') },
      // Browser supabase-js has no thin equivalent (packet 08 Decision 2): keep
      // supabase-js OUT of the bundle. draft.ts resolves a null session (no draft
      // recovery in thin — fail-closed); the recording port owns audio upload.
      { find: '@/lib/supabase/client', replacement: port('supabase-client.stub.ts') },
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
