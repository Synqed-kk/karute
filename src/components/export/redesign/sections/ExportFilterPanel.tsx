'use client'

import { useTranslations } from 'next-intl'
import { Filter, X, Check, Calendar } from 'lucide-react'
import { SCOPES, type ScopeKey } from '@/lib/export/scopes'

interface ExportFilterPanelProps {
  scopeKey: ScopeKey
  filters: Record<string, string[]>
  onChange: (next: Record<string, string[]>) => void
  range: string
  onRangeChange: (next: string) => void
  locale: string
}

export function ExportFilterPanel({
  scopeKey,
  filters,
  onChange,
  range,
  onRangeChange,
  locale,
}: ExportFilterPanelProps) {
  const t = useTranslations('dataExport')
  const scope = SCOPES[scopeKey]
  const isJa = locale === 'ja'

  const presets = [
    { key: '7d', label: t('preset7d') },
    { key: '30d', label: t('preset30d') },
    { key: '90d', label: t('preset90d') },
    { key: 'ytd', label: t('presetYtd') },
    { key: 'all', label: t('presetAll') },
  ]

  function toggleFilter(filterKey: string, value: string) {
    const current = filters[filterKey] ?? []
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    onChange({ ...filters, [filterKey]: next })
  }

  function clearAll() {
    onChange({})
    onRangeChange('30d')
  }

  const activeFilterCount = Object.values(filters).reduce(
    (n, arr) => n + (arr?.length || 0),
    0,
  )

  const rangeLabel =
    scopeKey === 'customers'
      ? t('dateRegistered')
      : scopeKey === 'bookings'
        ? t('dateScheduled')
        : t('dateSession')

  return (
    <section className="rounded-xl border border-border/30 bg-card/50 p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-[14.5px] font-semibold flex items-center gap-2">
            <Filter className="size-3.5 text-blue-500 dark:text-blue-300" />
            {t('filter')}
            <span className="text-[11px] font-normal text-muted-foreground ml-1">
              {activeFilterCount === 0
                ? t('noFilters')
                : t('filtersActive', { count: activeFilterCount })}
            </span>
          </h3>
          <div className="text-[12px] text-muted-foreground mt-0.5">
            {t('narrowDescription')}
          </div>
        </div>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <X className="size-3" /> {t('clearAll')}
          </button>
        )}
      </div>

      <div className="mb-4">
        <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-2">
          {t('dateRange')} ({rangeLabel})
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {presets.map((p) => (
            <FilterChip
              key={p.key}
              active={range === p.key}
              onClick={() => onRangeChange(p.key)}
            >
              {p.label}
            </FilterChip>
          ))}
          <FilterChip
            active={range === 'custom'}
            onClick={() => onRangeChange('custom')}
          >
            <Calendar className="size-3" /> {t('presetCustom')}
          </FilterChip>
        </div>
        {range === 'custom' && (
          <div className="mt-3 flex items-center gap-2">
            <input
              type="date"
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm w-[160px]"
            />
            <span className="text-muted-foreground text-xs">→</span>
            <input
              type="date"
              className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm w-[160px]"
            />
          </div>
        )}
      </div>

      {scope.filters.map((f) => (
        <div key={f.key} className="mb-4 last:mb-0">
          <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-2">
            {isJa ? f.labelJa : f.label}
          </div>
          <div className="flex flex-wrap gap-2">
            {f.options.map((opt) => {
              const active = (filters[f.key] ?? []).includes(opt)
              return (
                <FilterChip
                  key={opt}
                  active={active}
                  onClick={() => toggleFilter(f.key, opt)}
                >
                  {active && <Check className="size-3" />}
                  {opt}
                </FilterChip>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? 'border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300'
          : 'border-border bg-card text-muted-foreground hover:bg-muted'
      }`}
    >
      {children}
    </button>
  )
}
