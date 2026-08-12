import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { realpathSync } from 'node:fs'
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

// SYNQED Business territory (phone-safety lock 1): Business is open-web only
// by construction, so NOTHING in the thin bundle may reach it. Unlike
// src/actions there is no port and never will be — arriving here at all is the
// bug, so this throws instead of substituting a stub.
//
// This is the build-time half of the isolation guard, and the half that judges
// what actually gets bundled: the CI diff gate reads PR paths and the jest
// suite reads import specifiers, but rollup resolves to REAL absolute paths.
// A symlink, alias or relative traversal that lands on Business code is caught
// here however it was spelled, because the path — not the spelling — is judged.
const BUSINESS_DIR = path.resolve(root, 'src/business') + path.sep

function isBusinessPath(id: string): boolean {
  // Drop rollup's query suffixes (?url, ?raw, ?worker) before touching the fs.
  const file = id.split('?')[0]
  if (file.startsWith(BUSINESS_DIR)) return true
  // Vite's default preserveSymlinks:false already hands us real paths; the
  // realpath re-check keeps the guard honest if that default ever flips.
  // Virtual modules (\0…) and generated ids have no real path — they throw
  // here and are correctly judged non-Business.
  try {
    return realpathSync(file).startsWith(BUSINESS_DIR)
  } catch {
    return false
  }
}
const PURCHASE_PORT = port('purchase-excluded.tsx')
const PENDING_SECTIONS_PORT = port('pending-sections-excluded.tsx')

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

// Rollout-gate denylist (design-parity packet 12 §S1, §B-3 S2, packet 17
// §S3, packet 20 §S5): settings sections whose tabs were PENDING (in-shell
// 準備中 via SettingsShell's pendingTabIds) — SettingsShell imports all ten
// sections unconditionally, so bundling these for code the tab-intercept
// guarantees never renders pushed the thin bundle over budget. StoresSection
// moved OUT of this list at S2, AuditLogSection at packet 17 §S3,
// StaffSection at packet 12 §B-3 S4b (StaffForm/PinSetup/
// VoiceEnrollmentDialog/InviteStaffDialog now ship in the bundle too) — all
// three tabs are live and their sections now ship in the bundle; the sole
// remaining entry, SyncSection, is WEB-ONLY (webOnlyTabIds, #585 — an
// honest Web版 copy, not 準備中), but the exclusion rationale is unchanged:
// its tab never renders the section in-shell either way. StoreFormDialog
// and its stores dialogs are NOT purchase surfaces (PURCHASE_FILES below
// still excludes the two that are). Names must also exist in
// thin/ports/pending-sections-excluded.tsx. Remove an entry the same PR its
// tab goes live.
const PENDING_SECTION_FILES = new Set(
  [
    'src/components/settings/redesign/sections/SyncSection.tsx',
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

      // (e) ANY module under src/business/** → LOUD build failure. No port
      // exists by design; see BUSINESS_DIR above.
      if (isBusinessPath(resolved.id)) {
        throw new Error(
          `[thin boundary] "${source}" imported by ${importer} resolves into SYNQED Business ` +
            `(${resolved.id}). Business is open-web only — the phone bundle must never reach it. ` +
            'If this is genuinely shared code, move it OUT of src/business/ in its own non-Business PR.',
        )
      }

      // (a) ANY module under src/actions/** → the loud facade proxy. Missing
      // named exports then fail the build per-name — correct and desired; names
      // are added to actions.vite.ts as screens convert.
      if (resolved.id.startsWith(ACTIONS_DIR)) return ACTIONS_PORT

      // (b) Purchase surfaces → null renders, whatever the import shape.
      if (PURCHASE_FILES.has(resolved.id)) return PURCHASE_PORT
      if (PURCHASE_VENDOR_SUFFIXES.some((s) => resolved.id.endsWith(s))) return PURCHASE_PORT

      // (d) Excluded settings sections (§S1, #585) → null renders. The
      // pendingTabIds/webOnlyTabIds runtime intercept already guarantees
      // these never render (SyncSection is webOnlyTabIds since #585, not
      // pendingTabIds); this cuts them (and their children) from the bundle too.
      if (PENDING_SECTION_FILES.has(resolved.id)) return PENDING_SECTIONS_PORT

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
      // Since the packet-01 auth wiring, supabase-js IS in the bundle (auth
      // only): the drop-in delegates auth to the mobile client so draft/take
      // owner gates see the real session, while storage.* still throws — the
      // recording port owns audio upload.
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
    // Ruling B (2026-08-11): check-bundle-budget.mjs proves which output
    // chunks derive solely from messages/*.json (translation data, exempt
    // from the prose-copy markers) off this manifest — never a filename
    // guess. Emitted to dist/.vite/manifest.json (Vite 5+ default location).
    manifest: true,
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
