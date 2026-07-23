'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ListChecks,
  Shield,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  Search,
  Check,
  X,
} from 'lucide-react'
import {
  SCOPES,
  GROUP_LABELS_JA,
  defaultColumnsFor,
  type ScopeKey,
} from '@/lib/export/scopes'

interface ExportColumnsPickerProps {
  scopeKey: ScopeKey
  selected: string[]
  onChange: (next: string[]) => void
  privacy: boolean
  locale: string
}

export function ExportColumnsPicker({
  scopeKey,
  selected,
  onChange,
  privacy,
  locale,
}: ExportColumnsPickerProps) {
  const t = useTranslations('dataExport')
  const scope = SCOPES[scopeKey]
  const isJa = locale === 'ja'
  const [expanded, setExpanded] = useState(true)
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const filtered = scope.columns.filter(
      (c) =>
        c.label.toLowerCase().includes(search.toLowerCase()) ||
        c.key.toLowerCase().includes(search.toLowerCase()),
    )
    const map: Record<string, typeof scope.columns> = {}
    for (const c of filtered) {
      if (!map[c.group]) map[c.group] = []
      map[c.group].push(c)
    }
    return map
  }, [scope, search])

  function toggle(key: string) {
    const col = scope.columns.find((c) => c.key === key)
    if (col?.required) return
    const next = selected.includes(key)
      ? selected.filter((k) => k !== key)
      : [...selected, key]
    onChange(next)
  }

  function selectPreset(preset: 'recommended' | 'all' | 'minimal' | 'no-pii') {
    if (preset === 'recommended') onChange(defaultColumnsFor(scopeKey))
    else if (preset === 'all') onChange(scope.columns.map((c) => c.key))
    else if (preset === 'minimal')
      onChange(scope.columns.filter((c) => c.required).map((c) => c.key))
    else if (preset === 'no-pii')
      onChange(
        scope.columns
          .filter((c) => !c.pii && (c.recommended || c.required))
          .map((c) => c.key),
      )
  }

  const piiCount = selected.filter(
    (k) => scope.columns.find((c) => c.key === k)?.pii,
  ).length

  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-[14.5px] font-semibold flex items-center gap-2">
            <ListChecks className="size-3.5 text-blue-500 dark:text-blue-300" />
            {t('columns')}
            <span className="text-[11px] font-normal text-muted-foreground ml-1">
              {t('columnsSummary', {
                selected: selected.length,
                total: scope.columns.length,
              })}
            </span>
          </h3>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {t('recommendedNote')}
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg bg-muted/40 p-1">
          <PresetButton onClick={() => selectPreset('recommended')}>
            {t('presetRecommended')}
          </PresetButton>
          <PresetButton onClick={() => selectPreset('no-pii')}>
            {t('presetNoPii')}
          </PresetButton>
          <PresetButton onClick={() => selectPreset('all')}>
            {t('presetAll')}
          </PresetButton>
          <PresetButton onClick={() => selectPreset('minimal')}>
            {t('presetMinimal')}
          </PresetButton>
        </div>
      </div>

      <div className="bg-muted/30 border border-border/30 rounded-lg p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.14em]">
            {t('selectedColumns')} ({scope.labelJa})
          </div>
          {piiCount > 0 && (
            <div className="text-[10.5px] text-amber-600 dark:text-amber-200/80 flex items-center gap-1.5">
              <Shield className="size-3" />
              {piiCount === 1
                ? t('piiCount', { count: piiCount })
                : t('piiCountPlural', { count: piiCount })}
              {privacy && (
                <span className="text-emerald-600 dark:text-emerald-300/80 ml-1">
                  · {t('redacted')}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {selected.length === 0 && (
            <span className="text-[12px] text-muted-foreground italic">
              {t('noColumnsSelected')}
            </span>
          )}
          {scope.columns
            .filter((c) => selected.includes(c.key))
            .map((c) => (
              <span
                key={c.key}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-mono ${
                  c.required
                    ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                    : 'bg-blue-500/10 border border-blue-500/30 text-blue-700 dark:text-blue-300'
                }`}
                title={c.label + (c.pii ? ' · contains PII' : '')}
              >
                {c.pii &&
                  (privacy ? (
                    <EyeOff className="size-2.5" />
                  ) : (
                    <Eye className="size-2.5 opacity-60" />
                  ))}
                {c.key}
                {!c.required && (
                  <button
                    onClick={() => toggle(c.key)}
                    className="ml-0.5 opacity-50 hover:opacity-100"
                    aria-label={`Remove ${c.key}`}
                  >
                    <X className="size-2.5" />
                  </button>
                )}
              </span>
            ))}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground mb-3"
      >
        {expanded ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        {expanded ? t('hideColumns') : t('showColumns')}
      </button>

      {expanded && (
        <div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <input
              className="w-full rounded-lg border border-border bg-background pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder={t('filterColumns')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {Object.entries(grouped).map(([group, cols]) => (
              <div key={group} className="mb-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground mb-1.5">
                  {isJa ? (GROUP_LABELS_JA[group] ?? group) : group}
                </div>
                <ul className="flex flex-col">
                  {cols.map((col) => {
                    const isSelected = selected.includes(col.key)
                    return (
                      <li key={col.key}>
                        <label
                          className={`flex items-center gap-2.5 py-1.5 px-2 -mx-2 rounded-md hover:bg-muted/40 ${
                            col.required
                              ? 'opacity-90 cursor-not-allowed'
                              : 'cursor-pointer'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              isSelected
                                ? col.required
                                  ? 'bg-emerald-500/80 border-emerald-400'
                                  : 'bg-blue-600 border-blue-500'
                                : 'border-border/60 bg-background'
                            }`}
                          >
                            {isSelected && (
                              <Check className="size-3 text-white" />
                            )}
                          </span>
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={isSelected}
                            readOnly
                            onClick={() => toggle(col.key)}
                          />
                          <span className="font-mono text-[12px] min-w-[140px]">
                            {col.key}
                          </span>
                          <span className="text-[11.5px] text-muted-foreground truncate flex-1">
                            {isJa ? col.labelJa : col.label}
                          </span>
                          <span className="flex items-center gap-1 shrink-0">
                            {col.required && (
                              <Tag color="emerald">{t('required')}</Tag>
                            )}
                            {col.recommended && !col.required && (
                              <Tag color="blue">{t('rec')}</Tag>
                            )}
                            {col.pii && <Tag color="amber">{t('pii')}</Tag>}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function PresetButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
    >
      {children}
    </button>
  )
}

function Tag({
  color,
  children,
}: {
  color: 'emerald' | 'blue' | 'amber'
  children: React.ReactNode
}) {
  const styles = {
    emerald:
      'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/25',
    blue: 'text-blue-700 dark:text-blue-300 bg-blue-500/10 border-blue-500/25',
    amber:
      'text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/25',
  }
  return (
    <span
      className={`text-[9.5px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5 border ${styles[color]}`}
    >
      {children}
    </span>
  )
}
