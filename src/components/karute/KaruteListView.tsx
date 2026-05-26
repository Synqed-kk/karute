'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import type { KaruteRichRow } from '@/lib/adapters/karute-list'

import { KaruteListHeader } from './redesign/KaruteListHeader'
import { KaruteSearchInput } from './redesign/KaruteSearchInput'
import {
  KaruteStatusFilters,
  type KaruteStatusFilterKey,
  type KaruteStatusCounts,
} from './redesign/KaruteStatusFilters'
import { KaruteDateGroup } from './redesign/KaruteDateGroup'

interface KaruteListViewProps {
  rows: KaruteRichRow[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function isoDayLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function isWithinDays(isoDay: string, days: number, todayIso: string): boolean {
  const [ty, tm, td] = todayIso.split('-').map(Number)
  const [y, m, d] = isoDay.split('-').map(Number)
  const today = new Date(ty, tm - 1, td)
  const that = new Date(y, m - 1, d)
  const diff = (today.getTime() - that.getTime()) / 86400000
  return diff >= 0 && diff < days
}

function isThisMonth(isoDay: string, todayIso: string): boolean {
  return isoDay.slice(0, 7) === todayIso.slice(0, 7)
}

function computeCounts(rows: KaruteRichRow[], todayIso: string): KaruteStatusCounts {
  let week = 0
  let aiPending = 0
  let review = 0
  let draft = 0
  for (const r of rows) {
    if (isWithinDays(r.date, 7, todayIso)) week++
    if (r.status === 'pending') aiPending++
    if (r.status === 'review') review++
    if (r.status === 'draft') draft++
  }
  return { all: rows.length, week, aiPending, review, draft }
}

function filterRows(
  rows: KaruteRichRow[],
  filter: KaruteStatusFilterKey,
  todayIso: string,
): KaruteRichRow[] {
  switch (filter) {
    case 'all':
      return rows
    case 'week':
      return rows.filter((r) => isWithinDays(r.date, 7, todayIso))
    case 'aiPending':
      return rows.filter((r) => r.status === 'pending')
    case 'review':
      return rows.filter((r) => r.status === 'review')
    case 'draft':
      return rows.filter((r) => r.status === 'draft')
  }
}

export function KaruteListView({ rows }: KaruteListViewProps) {
  const t = useTranslations('karuteList')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<KaruteStatusFilterKey>('all')

  const todayIso = useMemo(() => isoDayLocal(new Date()), [])

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        (r.staffName ?? '').toLowerCase().includes(q) ||
        (r.service ?? '').toLowerCase().includes(q),
    )
  }, [rows, search])

  const counts = useMemo(() => computeCounts(searched, todayIso), [searched, todayIso])
  const filtered = useMemo(
    () => filterRows(searched, filter, todayIso),
    [searched, filter, todayIso],
  )

  const monthCount = useMemo(
    () => rows.filter((r) => isThisMonth(r.date, todayIso)).length,
    [rows, todayIso],
  )
  const last14Count = useMemo(
    () => rows.filter((r) => isWithinDays(r.date, 14, todayIso)).length,
    [rows, todayIso],
  )

  const groups = useMemo(() => {
    const map = new Map<string, KaruteRichRow[]>()
    for (const r of filtered) {
      const list = map.get(r.date) ?? []
      list.push(r)
      map.set(r.date, list)
    }
    const dates = Array.from(map.keys()).sort((a, b) => (a < b ? 1 : -1))
    return dates.map((d) => ({ date: d, rows: map.get(d)! }))
  }, [filtered])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:gap-5 md:p-6">
      <KaruteListHeader
        monthCount={monthCount}
        last14Count={last14Count}
        showingCount={filtered.length}
      />
      <KaruteSearchInput value={search} onChange={setSearch} />
      <KaruteStatusFilters active={filter} counts={counts} onChange={setFilter} />

      {groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-10 text-center">
          <div className="text-sm font-semibold text-foreground">{t('empty.title')}</div>
          <div className="mt-1 text-xs text-muted-foreground">{t('empty.hint')}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5 md:gap-6">
          {groups.map((g) => (
            <KaruteDateGroup
              key={g.date}
              isoDate={g.date}
              rows={g.rows}
              todayIso={todayIso}
            />
          ))}
        </div>
      )}
    </div>
  )
}
