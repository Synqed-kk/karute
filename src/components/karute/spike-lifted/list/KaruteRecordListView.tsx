'use client'

// LIFTED + ADAPTED FROM SPIKE
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/karute-list/KaruteList.tsx
//
// Karute records list — record-centric view for the カルテ tab.
// Replaces the customer-centric list that previously rendered here.
//
// Layout (matches spike):
//   - Sticky title bar (カルテ + bell)
//   - Status line + "+ 新規カルテ" button
//   - Search input (filter by customer / service / staff / summary)
//   - Filter chips (すべて / 今週 / AI補完待ち / レビュー要 / 下書き)
//   - Date-grouped records — each date renders a header
//     "YYYY/MM/DD (曜) · 本日/昨日 · N件のカルテ" then the rows
//
// Adaptations from spike:
//   useT()/useTheme()/useRole()/useViewMode()/useShowCrossStaffNames
//                              → useTranslations() + useLocale()
//   Spike's per-staff filter UI → not lifted yet (this commit focuses
//                                  on records + filters; per-staff
//                                  scoping can layer in later)

import { Bell } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CustomerSearchInput } from '@/components/customers/redesign/list/CustomerSearchInput'
import { KaruteListRow } from './KaruteListRow'
import type { KaruteListFilter, KaruteListItem } from './types'

interface Props {
  items: KaruteListItem[]
  /** Total karute records this month (not filtered) — shown in the
   *  status line independent of the active filter. */
  monthCount: number
  /**
   * Customers with NO karute records yet — rendered in a separate
   * "新規のお客様 (まだセッションなし)" section below the date-grouped
   * records so brand-new customers don't vanish from the karute tab.
   * Each placeholder is a KaruteListItem with isPlaceholder=true; the
   * view filters them out of the date-grouping pass and renders them
   * separately. Filter chips don't apply (placeholders aren't karute
   * records — they're customers waiting for their first session).
   */
  placeholders?: KaruteListItem[]
}

const PAGE_SIZE = 12

const FILTER_KEYS: KaruteListFilter[] = [
  'all',
  'thisWeek',
  'aiPending',
  'needsReview',
  'draft',
]

export function KaruteRecordListView({
  items,
  monthCount,
  placeholders = [],
}: Props) {
  const t = useTranslations('karute.recordList')
  const tHead = useTranslations('karute')
  const locale = useLocale()
  const [filter, setFilter] = useState<KaruteListFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)

  // Reset to first page when filter or search changes — otherwise a
  // narrower result set strands the viewer on an empty page.
  useEffect(() => {
    setPage(0)
  }, [filter, searchQuery])

  const counts = useMemo(() => {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoff = sevenDaysAgo.toISOString().slice(0, 10)
    return {
      all: items.length,
      thisWeek: items.filter((i) => i.date >= cutoff).length,
      aiPending: items.filter((i) => i.aiStatus === 'pending').length,
      needsReview: items.filter((i) => i.aiStatus === 'needsReview').length,
      draft: items.filter((i) => i.aiStatus === 'draft').length,
    } satisfies Record<KaruteListFilter, number>
  }, [items])

  const filtered = useMemo(() => {
    let result = items
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    const cutoff = sevenDaysAgo.toISOString().slice(0, 10)
    if (filter === 'thisWeek') result = result.filter((i) => i.date >= cutoff)
    else if (filter === 'aiPending')
      result = result.filter((i) => i.aiStatus === 'pending')
    else if (filter === 'needsReview')
      result = result.filter((i) => i.aiStatus === 'needsReview')
    else if (filter === 'draft')
      result = result.filter((i) => i.aiStatus === 'draft')

    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter((i) => {
        return (
          i.customerName.toLowerCase().includes(q) ||
          i.service.toLowerCase().includes(q) ||
          i.staffName.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q)
        )
      })
    }
    return result
  }, [items, filter, searchQuery])

  // Page slice (in-memory, same approach as customer list)
  const pageItems = useMemo(() => {
    const start = page * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])

  // Group page items by date for the date-section headers
  const grouped = useMemo(() => {
    const map = new Map<string, KaruteListItem[]>()
    for (const item of pageItems) {
      const arr = map.get(item.date) ?? []
      arr.push(item)
      map.set(item.date, arr)
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a))
  }, [pageItems])

  const today = new Date().toISOString().slice(0, 10)
  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })()

  function dayLabelFor(date: string): string | null {
    if (date === today) return t('dateGroup.today')
    if (date === yesterday) return t('dateGroup.yesterday')
    return null
  }

  function formatDateHeader(date: string): string {
    const dt = new Date(`${date}T00:00:00+09:00`)
    return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
      year: 'numeric',
      month: locale === 'ja' ? 'long' : 'short',
      day: 'numeric',
      weekday: 'short',
    }).format(dt)
  }

  return (
    <main className="mx-auto w-full max-w-6xl flex-col pb-6">
      {/* Sticky title bar — same pattern as customers list */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border/40 bg-background/80 px-4 backdrop-blur md:-mx-6 md:px-6">
        <div className="relative flex items-center justify-center py-2">
          <h1 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
            {tHead('tabHeading')}
          </h1>
          <button
            type="button"
            className="absolute right-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="通知"
          >
            <Bell size={16} />
          </button>
        </div>
      </div>

      {/* Status line + New karute button */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:px-6">
        <p className="text-xs tabular-nums text-muted-foreground">
          {t('statusLine', { monthCount, showingCount: filtered.length })}
        </p>
        {/* + 新規カルテ button (stub — Anthony wires create-karute flow) */}
        <button
          type="button"
          disabled
          title="Coming soon — new karute flow not wired"
          className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-md bg-foreground/90 px-3 text-[13px] font-medium text-background opacity-90"
        >
          {t('newKarute')}
        </button>
      </div>

      {/* Search input — reuses the customer search input visually */}
      <div className="px-4 pt-3 md:px-6">
        <label className="flex w-full items-center gap-2 rounded-[10px] border border-border bg-card px-3 focus-within:border-sky-500">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-9 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          />
        </label>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3 md:px-6">
        {FILTER_KEYS.map((key) => {
          const isActive = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors ${
                isActive
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-foreground hover:bg-muted'
              }`}
            >
              <span>{t(`filters.${key}`)}</span>
              <span
                className={`tabular-nums ${isActive ? 'text-background/70' : 'text-muted-foreground'}`}
              >
                {counts[key]}
              </span>
            </button>
          )
        })}
      </div>

      {/* List — date-grouped sections */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
        {grouped.length === 0 && placeholders.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          </div>
        ) : grouped.length === 0 ? null : (
          grouped.map(([date, items]) => {
            const dayLabel = dayLabelFor(date)
            return (
              <div key={date}>
                {/* Date section header */}
                <div className="border-b border-border/40 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground md:px-5">
                  <span className="tabular-nums text-foreground">
                    {formatDateHeader(date)}
                  </span>
                  {dayLabel && (
                    <>
                      <span aria-hidden> · </span>
                      <span className="text-blue-700 dark:text-blue-300">
                        {dayLabel}
                      </span>
                    </>
                  )}
                  <span aria-hidden> · </span>
                  <span>{t('dateGroup.suffix', { n: items.length })}</span>
                </div>
                {items.map((item) => (
                  <KaruteListRow key={item.id} item={item} />
                ))}
              </div>
            )
          })
        )}
      </div>

      {/* Placeholder section — customers without any karute records yet.
       *  Sits below the date-grouped records so brand-new customers are
       *  visible on this tab without polluting the session-record list. */}
      {placeholders.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border/60 bg-card">
          <div className="border-b border-border/40 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground md:px-5">
            <span className="font-medium text-foreground">
              {t('newCustomersHeader')}
            </span>
            <span aria-hidden> · </span>
            <span>{t('dateGroup.suffix', { n: placeholders.length })}</span>
          </div>
          {placeholders.map((item) => (
            <KaruteListRow key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Simple pagination footer (reused conceptually from customers list) */}
      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 px-4 pt-3 md:px-6">
          <p className="text-xs tabular-nums text-muted-foreground">
            {(page * PAGE_SIZE + 1).toLocaleString()}-
            {Math.min((page + 1) * PAGE_SIZE, filtered.length).toLocaleString()} /
            {' '}
            {filtered.length.toLocaleString()}
          </p>
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= filtered.length}
              onClick={() => setPage(page + 1)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
