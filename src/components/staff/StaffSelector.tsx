'use client'

// 担当トリガー (Liam-approved option D): the per-staff pill rows collapse into
// ONE chip that names the current selection; tapping opens a bottom-sheet
// roster. Constant one-line footprint from 9 staff to 200 — the multi-store
// future never re-breaks the chrome. Shared by 顧客 / カルテ / 予約 (one
// pattern everywhere, per Liam's universality rule); the 自分/全スタッフ
// segment stays OUTSIDE this component so both dominant actions remain
// one-tap.

import { useMemo, useState } from 'react'
import { Check, ChevronDown, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  assignStaffColors,
  getStaffColorByKey,
} from '@/lib/staff-colors'
import { cn } from '@/lib/utils'

export interface StaffSelectorEntry {
  id: string
  name: string
  initials: string
}

export function StaffSelector({
  staffList,
  selected,
  onChange,
  compact = false,
}: {
  staffList: StaffSelectorEntry[]
  /** 'all' | 'self' | <staffId> — same model as the old pills. */
  selected: string
  onChange: (next: string) => void
  /** 予約 page: avatar + chevron only — the tightest line in the app. */
  compact?: boolean
}) {
  const t = useTranslations('staffSelector')
  const [open, setOpen] = useState(false)
  // Same DISTINCT color mapping as the card stripes/old pills — a stylist's
  // color is identical everywhere they appear.
  const staffColors = useMemo(
    () => assignStaffColors(staffList.map((s) => s.id)),
    [staffList],
  )
  if (staffList.length === 0) return null

  const active = staffList.find((s) => s.id === selected) ?? null
  const activeColor = active
    ? getStaffColorByKey(staffColors.get(active.id)?.key)
    : null

  const pick = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          'inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted',
          active && 'pr-2',
        )}
      >
        {active ? (
          <>
            <span
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                activeColor?.bg,
                activeColor?.text,
              )}
              aria-hidden
            >
              {active.initials}
            </span>
            {/* avatar + name only — the 担当: prefix read as clutter once a
             *  staff is picked (Liam); the unselected state keeps 「担当」. */}
            <span className={cn('truncate', compact ? 'max-w-[6rem]' : 'max-w-[9rem]')}>
              {active.name}
            </span>
          </>
        ) : (
          <>
            <Users size={13} className="shrink-0 text-muted-foreground" aria-hidden />
            <span>{t('trigger')}</span>
          </>
        )}
        <ChevronDown size={13} className="shrink-0 text-muted-foreground" aria-hidden />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[70vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle className="text-left text-sm">{t('title')}</SheetTitle>
          </SheetHeader>
          <ul className="mt-2 divide-y divide-border/60">
            <li>
              <button
                type="button"
                onClick={() => pick('all')}
                className="flex h-12 w-full items-center gap-3 px-1 text-left text-[13px] text-foreground"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
                  <Users size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate">{t('all')}</span>
                {!active && <Check size={15} className="shrink-0 text-foreground" aria-hidden />}
              </button>
            </li>
            {staffList.map((s) => {
              const color = getStaffColorByKey(staffColors.get(s.id)?.key)
              const isActive = selected === s.id
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pick(isActive ? 'all' : s.id)}
                    className="flex h-12 w-full items-center gap-3 px-1 text-left text-[13px] text-foreground"
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        color.bg,
                        color.text,
                      )}
                      aria-hidden
                    >
                      {s.initials}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {isActive && <Check size={15} className="shrink-0 text-foreground" aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  )
}
