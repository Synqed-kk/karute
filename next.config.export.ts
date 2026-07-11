// SPIKE ARTIFACT (spike/export-carveout) — NOT wired into `npm run build`.
// Approach A probe: can the App Router site be carved out via `output: 'export'`
// scoped to the customers/[id] subtree? Swap this over next.config.ts to reproduce
// the walls captured in reports/spike-export.md. The normal build reads
// next.config.ts and is untouched by this file's existence.
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./next-intl.config.ts')

const nextConfig: NextConfig = {
  output: 'export',
  // next/image can't optimize in a static export — the profile page's photos
  // would 404 without this. ponytail: cosmetic-only; the real walls fire first.
  images: { unoptimized: true },
}

export default withNextIntl(nextConfig)
