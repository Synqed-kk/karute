'use client'

import { useTranslations } from 'next-intl'
import { Users, Calendar, Clipboard, Database, type LucideIcon } from 'lucide-react'
import { SCOPES, type ScopeKey } from '@/lib/export/scopes'

const ICONS: Record<string, LucideIcon> = {
  Users,
  Calendar,
  Clipboard,
}

interface ExportScopePickerProps {
  value: ScopeKey
  onChange: (key: ScopeKey) => void
  totals: Record<ScopeKey, number>
  locale: string
}

const TINTS = {
  blue: {
    active: 'bg-blue-600 text-white',
    icon: 'text-blue-600 dark:text-blue-300',
    border: 'border-blue-500/40 bg-blue-500/5',
  },
  violet: {
    active: 'bg-violet-600 text-white',
    icon: 'text-violet-600 dark:text-violet-300',
    border: 'border-violet-500/40 bg-violet-500/5',
  },
  emerald: {
    active: 'bg-emerald-600 text-white',
    icon: 'text-emerald-600 dark:text-emerald-300',
    border: 'border-emerald-500/40 bg-emerald-500/5',
  },
}

export function ExportScopePicker({
  value,
  onChange,
  totals,
}: ExportScopePickerProps) {
  const t = useTranslations('dataExport')

  return (
    <section>
      <div className="text-[10.5px] font-semibold text-muted-foreground uppercase tracking-[0.14em] mb-3">
        {t('scopeQuestion')}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(Object.values(SCOPES) as (typeof SCOPES)[ScopeKey][]).map((scope) => {
          const active = scope.key === value
          const Icon = ICONS[scope.icon] ?? Users
          const tint = TINTS[scope.tint]
          return (
            <button
              key={scope.key}
              type="button"
              onClick={() => onChange(scope.key)}
              className={`text-left p-4 rounded-xl border transition-colors ${
                active
                  ? tint.border
                  : 'border-border/40 bg-card/40 hover:bg-card'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    active ? tint.active : `bg-muted ${tint.icon}`
                  }`}
                >
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-semibold flex items-baseline gap-2">
                    {scope.label}
                    <span className="text-[11px] font-normal text-muted-foreground font-mono">
                      {scope.labelJa}
                    </span>
                  </div>
                  <div className="text-[12px] text-muted-foreground mt-0.5">
                    {scope.sub}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Database className="size-3" />
                <span>
                  {t('recordsAvailable', {
                    count: (totals[scope.key] ?? 0).toLocaleString(),
                  })}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
