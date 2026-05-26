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

import { FilePlus2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  CustomersStaffFilter,
  type StaffFilterEntry,
  type StaffFilterKey,
} from '@/components/customers/redesign/list/CustomersStaffFilter'

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
  /** Staff list for the "your customers / all customers" filter. */
  staffList?: StaffFilterEntry[]
  /** The viewer's staff id — drives the "Me" filter pill. Null when
   *  the session has no active staff. */
  currentStaffId?: string | null
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
  staffList = [],
  currentStaffId = null,
}: Props) {
  const t = useTranslations('karute.recordList')
  const tHead = useTranslations('karute')
  const locale = useLocale()
  const [filter, setFilter] = useState<KaruteListFilter>('all')
  const [staffFilter, setStaffFilter] = useState<StaffFilterKey>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [page, setPage] = useState(0)

  // Reset to first page when filter or search changes — otherwise a
  // narrower result set strands the viewer on an empty page.
  useEffect(() => {
    setPage(0)
  }, [filter, searchQuery, staffFilter])

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

    // Staff scope: 'all' shows every record; 'self' filters to the
    // current viewer's records only; a specific id filters to that
    // staff. Records with no staffId are kept on 'all', dropped
    // on any specific scope.
    if (staffFilter === 'self' && currentStaffId) {
      result = result.filter((i) => i.staffId === currentStaffId)
    } else if (staffFilter !== 'all' && staffFilter !== 'self') {
      result = result.filter((i) => i.staffId === staffFilter)
    }

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
  }, [items, filter, searchQuery, staffFilter, currentStaffId])

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
    // Owns its own px-4 md:px-6 — the (app) layout provides no horizontal
    // padding now (system rule). The sticky title bar inside uses
    // `-mx-4 md:-mx-6` to bleed back to viewport edges for the iOS
    // sticky-header pattern (its bg + border line span full-width).
    <main className="mx-auto w-full max-w-6xl flex-col px-4 pb-6 md:px-6">
      {/* Title row — h1 visible on desktop only (MobileHeader
       *  handles the mobile title to avoid the duplicate
       *  "カルテ" rendering at top + below). Stats + primary CTA
       *  share a non-wrapping flex row so the button stays
       *  pinned right at every viewport width.
       *
       *  Earlier version used flex-wrap which pushed the button
       *  below the stats column on mobile, making it invisible
       *  inside the viewport. */}
      <div className="mt-3 md:mt-5">
        <h1 className="hidden text-2xl font-semibold tracking-tight text-foreground md:block md:text-[26px]">
          {tHead('tabHeading')}
        </h1>
        <div className="mt-1 flex items-start justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs tabular-nums text-muted-foreground">
            {t('statusLine', { monthCount, showingCount: filtered.length })}
          </p>
          {/* + 新規カルテ — primary CTA. ANTHONY wires the create-karute
           *  flow; today the button routes staff to /sessions to start a
           *  recording (the canonical karute-creation entry point). */}
          <a
            href={`/${locale}/sessions`}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md bg-sage-800 px-4 text-[13px] font-medium text-white transition-colors hover:bg-sage-900"
          >
            <FilePlus2 className="size-3.5" aria-hidden />
            {t('newKarute')}
          </a>
        </div>
      </div>

      {/* Staff-scope filter — "your customers / all / specific staff" */}
      {staffList.length > 0 && (
        <div className="mt-3">
          <CustomersStaffFilter
            staffList={staffList}
            selfStaffId={currentStaffId ?? null}
            selected={staffFilter}
            onChange={setStaffFilter}
          />
        </div>
      )}

      {/* Search input — reuses the customer search input visually */}
      <div className="pt-3">
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
      <div className="flex flex-wrap items-center gap-2 pt-3">
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

      {/* List — date-grouped sections. Sits inside the layout's 16px
       *  horizontal padding so the rounded card has breathing room from
       *  the screen edges, matching the design spike. */}
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
        <div className="flex items-center justify-between gap-3 pt-3">
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
