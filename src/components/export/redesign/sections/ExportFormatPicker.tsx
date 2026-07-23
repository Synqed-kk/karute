'use client'

import { useTranslations } from 'next-intl'
import {
  FileSpreadsheet,
  FileCode,
  FileText,
  Lock,
  Info,
  type LucideIcon,
} from 'lucide-react'
import {
  FORMATS,
  SCOPES,
  type FormatKey,
  type ScopeKey,
} from '@/lib/export/scopes'

const ICONS: Record<string, LucideIcon> = {
  FileSpreadsheet,
  FileCode,
  FileText,
}

interface ExportFormatPickerProps {
  scopeKey: ScopeKey
  value: FormatKey
  onChange: (key: FormatKey) => void
  locale: string
}

export function ExportFormatPicker({
  scopeKey,
  value,
  onChange,
  locale,
}: ExportFormatPickerProps) {
  const t = useTranslations('dataExport')
  const isJa = locale === 'ja'

  return (
    <section>
      <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3">
        {t('fileFormat')}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {FORMATS.map((fmt) => {
          const Icon = ICONS[fmt.icon] ?? FileSpreadsheet
          const supported = fmt.supports.includes(scopeKey)
          const active = supported && value === fmt.key
          return (
            <button
              key={fmt.key}
              type="button"
              disabled={!supported}
              onClick={() => supported && onChange(fmt.key)}
              className={`text-left p-3 rounded-xl border transition-colors ${
                active
                  ? 'border-blue-500/40 bg-blue-500/5'
                  : !supported
                    ? 'border-border/30 bg-card/20 opacity-50 cursor-not-allowed'
                    : 'border-border/40 bg-card/40 hover:bg-card'
              }`}
              title={
                !supported
                  ? t('notAvailableFor', { scope: SCOPES[scopeKey].label })
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={`size-4 ${
                    active
                      ? 'text-blue-600 dark:text-blue-300'
                      : 'text-muted-foreground'
                  }`}
                />
                <span className="text-[13.5px] font-semibold">{fmt.label}</span>
                {!supported && (
                  <Lock className="size-3 ml-auto text-muted-foreground" />
                )}
              </div>
              <div className="text-[11.5px] text-muted-foreground leading-snug mt-1">
                {isJa ? fmt.subJa : fmt.sub}
              </div>
              <div className="text-[10.5px] text-muted-foreground/70 font-mono mt-0.5">
                {isJa ? fmt.metaJa : fmt.meta}
              </div>
            </button>
          )
        })}
      </div>
      {value === 'pdf' && (
        <div className="mt-3 text-[12px] text-amber-700 dark:text-amber-200/85 flex items-start gap-2">
          <Info className="size-3.5 mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
          <span>{t('pdfHint')}</span>
        </div>
      )}
    </section>
  )
}
