'use client'

// ─────────────────────────────────────────────────────────────
// ImportScopePicker — pick what data type to import
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/import/ImportScopePicker.tsx
// Three options: customers, reservations, karute. Each tile
// shows an icon, label, and short description so owners know
// what they're about to upload before they pick a file.

import { Calendar, ClipboardList, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { ImportScope } from './types'

interface ImportScopePickerProps {
  value: ImportScope
  onChange: (scope: ImportScope) => void
}

interface Option {
  key: ImportScope
  labelKey: string
  descriptionKey: string
  icon: LucideIcon
}

const OPTIONS: Option[] = [
  {
    key: 'customers',
    labelKey: 'scopeCustomers',
    descriptionKey: 'scopeCustomersDesc',
    icon: Users,
  },
  {
    key: 'reservations',
    labelKey: 'scopeReservations',
    descriptionKey: 'scopeReservationsDesc',
    icon: Calendar,
  },
  {
    key: 'karute',
    labelKey: 'scopeKarute',
    descriptionKey: 'scopeKaruteDesc',
    icon: ClipboardList,
  },
]

export function ImportScopePicker({
  value,
  onChange,
}: ImportScopePickerProps) {
  const t = useTranslations('dataImport.scope')

  return (
    <div className="mb-5">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {t('question')}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((opt) => {
          const active = opt.key === value
          const Icon = opt.icon
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => onChange(opt.key)}
              className={`group rounded-lg border p-3 text-left transition-colors ${
                active
                  ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-400/30 dark:bg-blue-500/10'
                  : 'border-gray-200 bg-card hover:border-blue-300 dark:border-white/10'
              }`}
            >
              <div className="flex items-center gap-2">
                <div
                  className={`flex size-7 items-center justify-center rounded-md ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 dark:bg-neutral-800 dark:text-gray-400'
                  }`}
                >
                  <Icon className="size-3.5" />
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {t(opt.labelKey)}
                </span>
              </div>
              <div className="mt-1.5 text-[11px] text-muted-foreground">
                {t(opt.descriptionKey)}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
