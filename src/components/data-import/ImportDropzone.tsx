'use client'

// ─────────────────────────────────────────────────────────────
// ImportDropzone — file picker + format reference
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/import/ImportDropzone.tsx
//
// NATIVE INTEGRATION NOTE
//   Today: HTML <input type="file"> with drag-and-drop UX.
//   Future: @capacitor/filesystem for iOS native picker.
//   Data flow unchanged — downstream parser consumes File/Blob
//   identically whether the source is web or Capacitor.
//
// ANTHONY contract — when the file is picked or dropped:
//   const session = await startImportSession({ file, scope })
//   //  - Uploads to Storage bucket 'imports'
//   //  - Inserts row into import_sessions with status='uploading'
//   //  - Kicks off the mapper edge function
//   // See spike's docs/INTEGRATION_GUIDE.md Part 8 for the full
//   // schema + edge function contract.

import { FileCode, FileSpreadsheet, FileText, UploadCloud } from 'lucide-react'
import { useRef } from 'react'
import { useTranslations } from 'next-intl'

import type { ImportScope } from './types'

interface ImportDropzoneProps {
  scope: ImportScope
}

const SAMPLE_COLUMNS: Record<ImportScope, string[]> = {
  customers: ['name', 'age', 'gender', 'phone', 'email', 'preferred_staff'],
  reservations: ['date', 'time', 'customer_name', 'service', 'duration', 'staff_id'],
  karute: ['session_date', 'customer_id', 'staff_id', 'entries', 'summary'],
}

export function ImportDropzone({ scope }: ImportDropzoneProps) {
  const t = useTranslations('dataImport.dropzone')
  const tScope = useTranslations('dataImport.scope')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const scopeLabel = tScope(
    scope === 'customers'
      ? 'scopeCustomers'
      : scope === 'reservations'
        ? 'scopeReservations'
        : 'scopeKarute',
  )

  const handlePickedFile = (file: File) => {
    // ANTHONY: replace this stub with the real session start.
    //   const session = await startImportSession({ file, scope })
    //   router.push(`/data-import/${session.id}`) // advances to step 2
    if (typeof window !== 'undefined') {
      console.info('[dev] Import file selected', {
        name: file.name,
        size: file.size,
        scope,
      })
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handlePickedFile(file)
  }

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files?.[0]
          if (file) handlePickedFile(file)
        }}
        className="flex flex-col items-center rounded-lg border-2 border-dashed border-gray-300 bg-card p-6 text-center transition-colors hover:border-blue-300 md:p-10 dark:border-white/15"
      >
        <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          <UploadCloud className="size-6" aria-hidden />
        </div>
        <div className="text-sm font-semibold text-foreground">
          {t('dropOrClick', { scope: scopeLabel })}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {t('supportedFormats')} · {t('maxSize')}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,application/json"
          onChange={handleChange}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          {t('chooseFile')}
        </button>
      </div>

      {/* Format reference cards */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormatCard
          icon={FileSpreadsheet}
          titleKey="csvTitle"
          descKey="csvDesc"
        />
        <FormatCard
          icon={FileText}
          titleKey="excelTitle"
          descKey="excelDesc"
        />
        <FormatCard
          icon={FileCode}
          titleKey="jsonTitle"
          descKey="jsonDesc"
        />
      </div>

      {/* Recommended columns for the active scope */}
      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.04]">
        <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t('recommendedCols', { scope: scopeLabel })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {SAMPLE_COLUMNS[scope].map((col) => (
            <span
              key={col}
              className="inline-flex h-5 items-center rounded border border-gray-200 bg-card px-2 font-mono text-[11px] text-foreground/80 dark:border-white/10"
            >
              {col}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function FormatCard({
  icon: Icon,
  titleKey,
  descKey,
}: {
  icon: LucideIconType
  titleKey: string
  descKey: string
}) {
  const t = useTranslations('dataImport.dropzone')
  return (
    <div className="rounded-xl bg-card p-3 shadow-sm ring-1 ring-black/5 dark:ring-white/10">
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-xs font-semibold text-foreground">
          {t(titleKey)}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t(descKey)}
      </p>
    </div>
  )
}

type LucideIconType = typeof FileSpreadsheet
