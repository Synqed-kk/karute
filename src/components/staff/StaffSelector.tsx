'use client'

// 担当トリガー — one chip that names the current selection; tapping opens an
// anchored DROPDOWN (2026-07-03, Liam: mirror the StoreSwitcher pattern — the
// previous bottom-sheet roster felt heavier than the store pill's menu).
// Constant one-line footprint from 9 staff to 200: the panel scrolls
// internally. Shared by 顧客 / カルテ / 予約 (one pattern everywhere); the
// 自分/全スタッフ segment stays OUTSIDE this component so both dominant
// actions remain one-tap.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, Users } from 'lucide-react'
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
  /** 経営メンバー — kept OUT of the default (no-query) list; typing a name
   *  reveals them (StaffCombobox recipe). ⚖ 2026-09-01 overturn of ruling Ⓒ:
   *  this FILTER now hides them by default too (Ⓒ said the filter never
   *  hides; Liam reversed that same evening — narrowing the view is still
   *  not assigning work, but a filter list that scrolls past a store's whole
   *  management roster to find a stylist earns its keep). fail-open:
   *  missing/undefined = visible, same idiom as the combobox. */
  isManagement?: boolean
}

// Japanese names are family-name-first, whitespace-separated
// (原田 かなみ → 原田, 牧之瀬 拓海 → 牧之瀬). The compact chip shows just the
// family name so the whole filter row fits one line at 440px. Splits on both
// ASCII and full-width (　) spaces; single-token names (江間, 浜野, Liam, or a
// space-less full-width name) pass through untouched and lean on the chip's
// max-width truncation as the backstop.
function familyName(full: string): string {
  const first = full.trim().split(/[\s　]+/)[0]
  return first || full
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
  const tc = useTranslations('common')
  const [open, setOpen] = useState(false)
  // Search box inside the panel (mock §①-④). Empty = the default list; a
  // query searches the WHOLE roster (management included, the reveal) —
  // same split as StaffCombobox's dirty/trimmedQuery. Reset on close so the
  // next open starts from the default list rather than a stale search.
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // The panel anchors `right-0` by default (opens leftward from the chip's
  // right edge, matching the StoreSwitcher). If the chip ever wraps to the
  // left edge of the viewport, right-anchoring pushes the 256px panel
  // off-screen left. This flag flips it to `left-0` in that case so the menu
  // is always fully on-screen — a backstop that costs nothing when the chip
  // sits where it should (on the right of its row).
  const [alignLeft, setAlignLeft] = useState(false)
  // Stable ids wire the a11y triad: trigger aria-controls → listbox, and the
  // listbox takes its accessible name from the visible header row.
  const listboxId = useId()
  const labelId = useId()

  // Same close behavior as the StoreSwitcher: outside tap or Escape — and the
  // same pointerdown, for the same reason (mousedown is a compatibility event
  // the bottom bar's touchend preventDefault suppresses; see StoreSwitcher).
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A key delivered mid-conversion belongs to the IME, not this panel —
      // same guard as MenuCombobox.tsx's Escape handler. Without it, the
      // search box's 変換-cancel Escape also closes the whole dropdown.
      if (e.isComposing || e.keyCode === 229) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Clamp the panel on-screen: after it opens (right-anchored), if its left
  // edge falls off the left of the viewport, flip to left-anchoring. Reset on
  // close so each open re-measures against the chip's current position.
  useLayoutEffect(() => {
    if (!open) {
      setAlignLeft(false)
      return
    }
    const el = panelRef.current
    if (!el) return
    const MARGIN = 8
    const rect = el.getBoundingClientRect()
    if (rect.left < MARGIN) setAlignLeft(true)
  }, [open])

  // Clear the search on close (outside tap, Escape, or a pick already closes
  // via `pick()`) — the next open shows the default list, not a stale query.
  useEffect(() => {
    if (!open) setQuery('')
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

  // '' until they type. Typing searches the WHOLE roster (management
  // included — the reveal); an untouched box shows the default list, which
  // hides 経営メンバー — except the CURRENT selection (F7, 2026-09-01:
  // combobox-parity with StaffCombobox's own `!isManagement || id ===
  // selfId || id === selectedId` leg — this component has no separate self
  // id to carry, so only the selected leg applies). Without it, picking a
  // flagged member from a search reveal left the reopened default list
  // showing nobody selected, even though the trigger chip named them
  // correctly. fail-open: `!s.isManagement` treats a missing/undefined flag
  // as visible.
  const trimmedQuery = query.trim()
  const visible = trimmedQuery
    ? staffList.filter((s) => s.name.toLowerCase().includes(trimmedQuery.toLowerCase()))
    : staffList.filter((s) => !s.isManagement || s.id === selected)

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
             *  staff is picked (Liam); the unselected state keeps 「担当」.
             *  The compact chip (予約 row) shows just the family name so the
             *  whole filter row stays one line at 440px; a max-width truncate
             *  is the backstop for extreme space-less single-token names. */}
            <span className={cn('truncate', compact ? 'max-w-[6rem]' : 'max-w-[9rem]')}>
              {compact ? familyName(active.name) : active.name}
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
          ref={panelRef}
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          // Open overlay: the shell's tab-swipe must not change the screen
          // under it (thin/gestures.ts walks for this tag).
          data-gesture-inert=""
          // right-0 opens the 256px panel leftward from the chip's right edge
          // — same as the StoreSwitcher — which is correct when the chip sits
          // on the RIGHT of its filter row. If the chip ever wraps to the left
          // edge (narrow phone), right-0 would push the panel off-screen left;
          // the useLayoutEffect above detects that and flips to left-0 so the
          // menu is always fully on-screen.
          // Internal scroll keeps the panel usable at any roster size — the
          // page never scrolls behind a giant menu. The keyboard-aware
          // max-h-[min(55vh,55dvh)] cap bounds the WHOLE panel (title +
          // search + list), not just the list — 55dvh mirrors the 55vh term
          // (desktop/no-keyboard: identical, unchanged), but the Android
          // keyboard shrinks dvh, so once it's open the entire panel caps to
          // the room actually left, same house pattern as StaffCombobox's
          // 35dvh cap. Ceiling: this doesn't reposition the panel's TOP
          // anchor — a trigger positioned low on the page can still push the
          // panel past the keyboard/bottom edge. Acceptable today because
          // every shipped surface renders this filter in the page header
          // near the top; if a low-trigger surface ever appears, upgrade to
          // measuring available space and repositioning.
          className={cn(
            'absolute top-full z-50 mt-1 flex max-h-[min(55vh,55dvh)] w-64 flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900',
            alignLeft ? 'left-0' : 'right-0',
          )}
        >
          <div
            id={labelId}
            className="shrink-0 border-b border-black/5 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10"
          >
            {t('title')}
          </div>
          {/* Search box (mock §①): filters the list below. Typing reveals
           *  経営メンバー — hidden from the default (empty-query) list above. */}
          <div className="shrink-0 border-b border-black/5 px-2.5 py-2 dark:border-white/10">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2.5 py-1.5">
              <Search size={14} className="shrink-0 text-muted-foreground" aria-hidden />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                aria-label={t('searchPlaceholder')}
                className="w-full min-w-0 rounded border-none bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>
          {/* Takes whatever room remains inside the capped panel above. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* 全スタッフ is pinned only on the DEFAULT list, same rule as
             *  StaffCombobox's 指名なし row — once typing starts this is a
             *  search result, and 全スタッフ isn't something the query matched. */}
            {!trimmedQuery && (
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
            )}
            {visible.map((s) => {
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
                  managementBadge={s.isManagement}
                  onClick={() => pick(isActive ? 'all' : s.id)}
                />
              )
            })}
            {/* Zero-hit search — same 該当なし recipe as StaffCombobox
             *  (common.noResults), so the panel never renders a bare
             *  "スタッフで絞り込み" header over an empty listbox. */}
            {trimmedQuery && visible.length === 0 && (
              <div className="px-3 py-2 text-[13px] text-muted-foreground">{tc('noResults')}</div>
            )}
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
  managementBadge,
}: {
  avatar: React.ReactNode
  label: string
  selected: boolean
  onClick: () => void
  /** 経営メンバー — true on rows surfaced by the search reveal, and also on
   *  the currently-selected management member's row in the default list.
   *  Same soft-wash chip recipe as StaffCombobox / StaffForm — light blue,
   *  never a black/solid fill. */
  managementBadge?: boolean
}) {
  const t = useTranslations('staff')
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
      {managementBadge && (
        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-blue-50 px-1.5 text-[10px] font-medium text-blue-800 ring-1 ring-blue-200/60 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
          {t('managementBadge')}
        </span>
      )}
      {selected && <Check className="ml-auto size-4 shrink-0" aria-hidden />}
    </button>
  )
}
