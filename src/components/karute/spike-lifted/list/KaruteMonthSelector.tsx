'use client'

// 月ジャンプ — the カルテ list's month chip + its anchored month panel (PR-2b).
// Mock: mocks/mock-karute-tab-restructure.html §.filter-pills-wrap — a bordered
// chip carrying a calendar icon, the month it currently shows, and a chevron;
// tapping opens a panel under it with 月を選択, the month list (current one
// highlighted) and the 「月を選ぶと…」 note.
//
// OVERLAY IDIOM: StaffSelector.tsx's 担当 chip, reused verbatim — the app's real
// anchored-panel pattern (2026-07-03, Liam: "mirror the StoreSwitcher"), which
// the mock's own caption promised: 「実際の画面ではこのパネルはチップの直下に
// 重なって開きます（モックでは下に並べて表示しています）」. That brings the
// pointerdown-outside close, the Escape close with its IME guard, the
// left-edge on-screen clamp, the internal scroll cap and the
// data-gesture-inert tag (thin's tab-swipe must not change the screen under an
// open overlay) — all already field-proven. Added on top, because the packet
// asks for keyboard/focus: focus lands on the current month when the panel
// opens, ArrowUp/ArrowDown walk the list, Escape returns focus to the chip, and
// focus leaving the panel closes it.
//
// The mock draws a static 「…」 row between the recent months and the oldest
// one. That is a paper stand-in for "the list keeps going" — a dead,
// unpressable row in a real picker, and it would make the months it stands for
// unreachable. Shipped instead: the whole contiguous range, scrolling inside
// the capped panel (StaffSelector's idiom).

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Calendar, Check, ChevronDown } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * Hard ceiling on the offered range — 20 years of months. The floor the caller
 * passes is derived from real data (the session-date epoch, extended by the
 * oldest row actually loaded), so this bounds only a corrupt input; it can
 * never truncate a range the store genuinely has.
 */
const MAX_MONTHS = 240

/** 'YYYY-MM' shifted by whole months, either direction. */
export function shiftMonth(month: string, delta: number): string {
  const m = Number(month.slice(5, 7)) - 1 + delta
  const year = Number(month.slice(0, 4)) + Math.floor(m / 12)
  return `${year}-${String((((m % 12) + 12) % 12) + 1).padStart(2, '0')}`
}

/**
 * Newest-first 'YYYY-MM' list from `newest` back to `oldest`, both inclusive.
 * Plain string compare is exact on zero-padded YYYY-MM, and an `oldest` that
 * is somehow NEWER than `newest` yields just `[newest]` rather than spinning.
 */
export function monthRange(newest: string, oldest: string): string[] {
  const out: string[] = []
  let year = Number(newest.slice(0, 4))
  let month = Number(newest.slice(5, 7))
  for (let i = 0; i < MAX_MONTHS; i += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}`
    out.push(key)
    if (key <= oldest) break
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return out
}

export function KaruteMonthSelector({
  currentMonth,
  oldestMonth,
  selected,
  onSelect,
  busy = false,
}: {
  /** 'YYYY-MM' — the JST calendar month containing today. Top of the list, and
   *  the chip's label while no other month is picked (the default view IS this
   *  month's newest rows). Picking it is how you come back — there is no
   *  「今月に戻る」 button. */
  currentMonth: string
  /** 'YYYY-MM' — oldest month to offer. */
  oldestMonth: string
  /** The picked month, or null for the default windowed view. */
  selected: string | null
  onSelect: (month: string) => void
  /** A month's rows are in flight — announced on the chip, not as a spinner. */
  busy?: boolean
}) {
  const t = useTranslations('karute.recordList.month')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [alignLeft, setAlignLeft] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const listboxId = useId()
  const labelId = useId()

  const months = monthRange(currentMonth, oldestMonth)
  // The chip names what the list is showing; with nothing picked that is the
  // current month, which is also the row the panel highlights.
  const shown = selected ?? currentMonth
  const activeIndex = Math.max(0, months.indexOf(shown))

  const formatMonth = (month: string) =>
    new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      // JST-explicit, same rule as the list's other date formatters (PR-2a fix
      // round 5): these are Japanese business months, not the viewer's local
      // wall clock, and a UTC server would otherwise render 8月 as 7月.
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: locale === 'ja' ? 'long' : 'short',
    }).format(new Date(`${month}-01T00:00:00+09:00`))

  // Outside tap / Escape — StaffSelector's handler verbatim, including the
  // pointerdown choice (mousedown is a compatibility event the bottom bar's
  // touchend preventDefault suppresses) and the IME guard (a 変換-cancel
  // Escape belongs to the input method, not to this panel). Escape ALSO puts
  // focus back on the chip: the panel is what the keyboard was inside of, so
  // dismissing it must not drop the caret at the top of the document.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (e.isComposing || e.keyCode === 229) return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Clamp on-screen: the panel opens leftward from the chip's right edge, which
  // is right while the chip sits at the right of its filter row. If it ever
  // wraps to the left edge, right-anchoring would push the panel off-screen —
  // measure once per open and flip. StaffSelector's backstop, same reason.
  useLayoutEffect(() => {
    if (!open) {
      setAlignLeft(false)
      return
    }
    const el = panelRef.current
    if (!el) return
    if (el.getBoundingClientRect().left < 8) setAlignLeft(true)
  }, [open])

  // Focus the month the list is currently showing, so the panel opens WHERE THE
  // USER IS rather than at the top of the document's tab order.
  useLayoutEffect(() => {
    if (!open) return
    optionRefs.current[activeIndex]?.focus()
    // activeIndex is read as a current value — re-running on it would yank
    // focus back mid-arrow-walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const pick = (month: string) => {
    setOpen(false)
    triggerRef.current?.focus()
    onSelect(month)
  }

  return (
    <div
      ref={wrapRef}
      className="relative inline-block shrink-0"
      // Blur close: focus leaving the chip+panel for somewhere else on the page
      // dismisses it, so a Tab out never leaves an orphaned overlay open behind
      // the caret. A NULL relatedTarget is deliberately ignored — that is focus
      // going nowhere focusable (a tap on the panel's own title, a window blur),
      // which the pointerdown handler above already judges correctly; closing on
      // it would make the panel collapse under a touch that never left it.
      onBlur={(e) => {
        if (!e.relatedTarget) return
        if (wrapRef.current?.contains(e.relatedTarget as Node)) return
        setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-busy={busy}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Calendar size={13} className="shrink-0 text-muted-foreground" aria-hidden />
        <span className="tabular-nums">{formatMonth(shown)}</span>
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
          // Open overlay: the shell's tab-swipe must not change the screen under
          // it (thin/gestures.ts walks for this tag).
          data-gesture-inert=""
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            e.preventDefault()
            const from = optionRefs.current.findIndex((el) => el === document.activeElement)
            const base = from === -1 ? activeIndex : from
            const next = e.key === 'ArrowDown' ? base + 1 : base - 1
            optionRefs.current[Math.min(Math.max(next, 0), months.length - 1)]?.focus()
          }}
          className={cn(
            'absolute top-full z-50 mt-1 flex max-h-[max(180px,min(55vh,55dvh))] w-[250px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900',
            alignLeft ? 'left-0' : 'right-0',
          )}
        >
          <div
            id={labelId}
            className="shrink-0 border-b border-black/5 px-3 py-2 text-[11px] text-muted-foreground dark:border-white/10"
          >
            {t('panelTitle')}
          </div>
          {/* Takes whatever room remains inside the capped panel — the range can
           *  run for years once the legacy sweep has loaded a deep history. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {months.map((month, i) => {
              const isActive = month === shown
              return (
                <button
                  key={month}
                  ref={(el) => {
                    optionRefs.current[i] = el
                  }}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => pick(month)}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-2 px-3 py-2 text-left text-[13px] tabular-nums transition-colors',
                    isActive
                      ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-500/10 dark:text-blue-200'
                      : 'text-foreground active:bg-black/[0.03] dark:active:bg-white/[0.04]',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{formatMonth(month)}</span>
                  {isActive && <Check className="size-4 shrink-0" aria-hidden />}
                </button>
              )
            })}
          </div>
          <p className="shrink-0 border-t border-black/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground dark:border-white/10">
            {t('note')}
          </p>
        </div>
      )}
    </div>
  )
}
