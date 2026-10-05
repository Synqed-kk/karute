// globalSetup for the bottom-bar hit-test (playwright.config.ts beside this
// file). Builds ./harness with the repo's own vite + Tailwind into
// node_modules/.cache — no next dev, no database, no seeds, no secrets.
import path from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/postcss'

const ROOT = path.resolve(__dirname, '../..')
const H = path.join(__dirname, 'harness')
export const HARNESS_OUT = path.join(ROOT, 'node_modules/.cache/bottom-nav-hit-harness')

export default async function buildHarness() {
  await build({
    configFile: false,
    root: H,
    base: './',
    logLevel: 'warn',
    plugins: [react()],
    define: { 'process.env': '{}' },
    css: { postcss: { plugins: [tailwind({ base: ROOT })] } },
    resolve: {
      alias: [
        { find: '@/i18n/navigation', replacement: path.join(H, 'mocks/navigation.tsx') },
        { find: 'next-intl', replacement: path.join(H, 'mocks/next-intl.ts') },
        { find: '@/hooks/use-global-recorder', replacement: path.join(H, 'mocks/recorder.ts') },
        { find: '@/lib/recordings/inbox-store', replacement: path.join(H, 'mocks/inbox.ts') },
        { find: /^@\//, replacement: path.join(ROOT, 'src') + '/' },
      ],
    },
    build: { outDir: HARNESS_OUT, emptyOutDir: true, modulePreload: false, cssCodeSplit: false },
  })
}
