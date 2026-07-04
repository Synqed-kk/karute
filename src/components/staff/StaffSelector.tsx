'use client'

// 担当トリガー — one chip that names the current selection; tapping opens an
// anchored DROPDOWN (2026-07-03, Liam: mirror the StoreSwitcher pattern — the
// previous bottom-sheet roster felt heavier than the store pill's menu).
// Constant one-line footprint from 9 staff to 200: the panel scrolls
// internally. Shared by 顧客 / カルテ / 予約 (one pattern everywhere); the
// 自分/全スタッフ segment stays OUTSIDE this component so both dominant
// actions remain one-tap.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
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
  const ref = useRef<HTMLDivElement>(null)
  // Stable ids wire the a11y triad: trigger aria-controls → listbox, and the
  // listbox takes its accessible name from the visible header row.
  const listboxId = useId()
  const labelId = useId()

  // Same close behavior as the StoreSwitcher: outside tap or Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
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
        <ChevronDown
          size={13}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          // right-0 opens the 256px panel leftward from the chip's right edge
          // — same as the StoreSwitcher. Safe because the chip sits on the
          // RIGHT of its filter row (last item after the 自分/全スタッフ
          // segment), so the panel has room to its left. The old breakage —
          // a blank panel pinned to the viewport's left edge — happened only
          // when the chip wrapped alone onto a second row and landed at the
          // LEFT edge; then right-0 pushed the panel ~174px off-screen left.
          // That wrap is gone now (the Day/Week/Month toggle no longer shares
          // this row), so the chip never sits far-left and right-0 stays on
          // screen at 393px.
          className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900"
        >
          <div
            id={labelId}
            className="border-b border-black/5 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10"
          >
            {t('title')}
          </div>
          {/* Internal scroll keeps the panel usable at any roster size —
           *  the page never scrolls behind a giant menu. */}
          <div className="max-h-[55vh] overflow-y-auto overscroll-contain">
            <StaffRow
              avatar={
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                  aria-hidden
                >
                  <Users size={13} />
                </span>
              }
              label={t('all')}
              selected={!active}
              onClick={() => pick('all')}
            />
            {staffList.map((s) => {
              const color = getStaffColorByKey(staffColors.get(s.id)?.key)
              const isActive = selected === s.id
              return (
                <StaffRow
                  key={s.id}
                  avatar={
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                        color.bg,
                        color.text,
                      )}
                      aria-hidden
                    >
                      {s.initials}
                    </span>
                  }
                  label={s.name}
                  selected={isActive}
                  onClick={() => pick(isActive ? 'all' : s.id)}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function StaffRow({
  avatar,
  label,
  selected,
  onClick,
}: {
  avatar: React.ReactNode
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex min-h-[44px] w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors',
        selected
          ? 'bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200'
          : 'text-foreground active:bg-black/[0.03] dark:active:bg-white/[0.04]',
      )}
    >
      {avatar}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
    </button>
  )
}
