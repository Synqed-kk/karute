// Fit harness build (S44, ⚖ FIT BY DESIGN 04:2x) — the three list tabs'
// REAL header components rendered offline with fixture data, for the
// Playwright fit test in ./run.mjs. It reuses the phone (thin) target's
// config wholesale — the same boundary plugin, the same aliases (next/*,
// src/actions → the loud facade port), the same Tailwind + local fonts — and
// changes only the entry (this folder) and the output. Nothing here reaches
// a network: the harness never calls an action, and run.mjs aborts every
// request that is not the harness's own origin.
import { defineConfig, mergeConfig } from 'vite'
import path from 'node:path'
import thinConfig from '../../thin/vite.config'

export default mergeConfig(
  thinConfig,
  defineConfig({
    root: __dirname,
    build: {
      outDir: path.resolve(__dirname, '../../node_modules/.cache/fit-harness'),
      emptyOutDir: true,
      manifest: false,
    },
  }),
)
