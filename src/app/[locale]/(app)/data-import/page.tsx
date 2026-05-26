// ─────────────────────────────────────────────────────────────
// /[locale]/data-import — owner data import page
// ─────────────────────────────────────────────────────────────
// Spike source: src/app/[locale]/(app)/import/page.tsx +
// components/import/ImportPage.tsx
//
// Replaces the 51-line drop-zone stub with the full spike chrome
// (stepper / scope picker / dropzone / recent imports table).
// Owner-only — staff don't have an import affordance.
//
// ANTHONY contracts inline in the lifted components:
//   ImportDropzone     → startImportSession() + Storage upload
//   RecentImportsTable → import_sessions query scoped to business_id
//   spike's docs/INTEGRATION_GUIDE.md Part 8 has the full schema +
//     edge function contract for the mapper job

import { getTranslations } from 'next-intl/server'

import { ImportPageView } from '@/components/data-import/ImportPageView'
import type { ImportRecord } from '@/components/data-import/types'

export default async function DataImportPage() {
  const t = await getTranslations('dataImport')

  // ANTHONY: hydrate from `import_sessions` table when wired:
  //   select * from import_sessions
  //   where business_id = $1
  //   order by created_at desc limit 10
  // For now: empty list so the table renders the empty-state copy.
  const recentImports: ImportRecord[] = []

  return (
    <div className="space-y-6">
      {/* Desktop-only title block — MobileHeader already shows
       *  データインポート on mobile, so the page-body heading
       *  duplicated it. Description still carries useful context
       *  so we keep it visible on desktop alongside the h1. */}
      <div className="hidden md:block">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t('description')}
        </p>
      </div>

      <ImportPageView recentImports={recentImports} />
    </div>
  )
}
