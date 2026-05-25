'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from '@/providers/session-provider'
import { StaffSwitcher } from '@/components/staff/StaffSwitcher'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function TopBar() {
  const t = useTranslations('switcher')
  const { activeStaff } = useSession()
  const [open, setOpen] = useState(false)
  return (
    <div className="flex h-14 shrink-0 items-center justify-end border-b border-border bg-[var(--color-bg)] px-4">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex size-7 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary overflow-hidden">
          {activeStaff?.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={activeStaff.avatarUrl} alt="" className="size-full object-cover" />
          ) : activeStaff ? initials(activeStaff.name) : '—'}
        </span>
        <span className="text-sm font-medium text-foreground">
          {activeStaff?.name ?? t('selectStaff')}
        </span>
      </button>
      <StaffSwitcher open={open} onClose={() => setOpen(false)} />
    </div>
  )
}
