'use client'

import { useMemo, useState } from 'react'
import { Link } from '@/i18n/navigation'
import type { KaruteListRowData } from '@synqed-kk/ui'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Chip } from '@/components/ui/chip'
import { Icon } from '@/components/ui/icon'
import { Button } from '@/components/ui/button'

interface KaruteListViewProps {
  rows: KaruteListRowData[]
}

interface DayGroup {
  date: string
  weekday: string
  count: number
  rows: KaruteListRowData[]
}

function groupByDay(rows: KaruteListRowData[]): DayGroup[] {
  const map = new Map<string, DayGroup>()
  for (const r of rows) {
    const key = r.dateDisplay
    const existing = map.get(key)
    if (existing) {
      existing.rows.push(r)
      existing.count += 1
    } else {
      map.set(key, { date: r.dateDisplay, weekday: r.weekday, count: 1, rows: [r] })
    }
  }
  return [...map.values()]
}

type AiTone = 'success' | 'warning' | 'danger' | 'accent'

function aiTone(row: KaruteListRowData): AiTone {
  switch (row.aiStatusTone) {
    case 'summarized':
      return 'success'
    case 'pending':
      return 'warning'
    case 'review_needed':
      return 'danger'
    default:
      return 'accent'
  }
}

const AVATAR_PALETTE = [
  'bg-sq-info-soft text-sq-info-text',
  'bg-sq-violet-soft text-sq-violet-text',
  'bg-sq-success-soft text-sq-success-text',
  'bg-sq-warning-soft text-sq-warning-text',
  'bg-sq-rose-soft text-sq-rose-text',
  'bg-sq-teal-soft text-sq-teal-text',
] as const

function avatarColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
}

export function KaruteListView({ rows }: KaruteListViewProps) {
  const [search, setSearch] = useState('')
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending'>('all')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let out = rows
    if (q) {
      out = out.filter(
        (r) =>
          r.customerName.toLowerCase().includes(q) ||
          r.summary.toLowerCase().includes(q),
      )
    }
    if (activeFilter === 'pending') {
      out = out.filter((r) => r.aiStatusTone === 'pending')
    }
    return out
  }, [rows, search, activeFilter])

  const groups = useMemo(() => groupByDay(filtered), [filtered])
  const pendingCount = rows.filter((r) => r.aiStatusTone === 'pending').length

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-sq-text-1">カルテ</h1>
          <p className="mt-1 text-sm text-sq-text-3">{rows.length}件のカルテを表示中</p>
        </div>
        <Button>
          <Icon name="fileText" size={14} />
          新規カルテ
        </Button>
      </header>

      <label className="relative block">
        <span className="sr-only">Search</span>
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sq-text-3"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="顧客名・サマリで検索…"
          className="h-12 w-full rounded-sq-md border border-sq-stroke-2 bg-sq-bg-2 pl-11 pr-4 text-sm text-sq-text-1 placeholder:text-sq-text-4 outline-none transition-colors focus:border-sq-accent focus:ring-2 focus:ring-sq-accent-ring"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={activeFilter === 'all'} count={rows.length} onClick={() => setActiveFilter('all')}>
          すべて
        </Chip>
        <Chip
          active={activeFilter === 'pending'}
          count={pendingCount}
          onClick={() => setActiveFilter('pending')}
        >
          AI補完待ち
        </Chip>
      </div>

      {groups.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm text-sq-text-3">該当するカルテがありません</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {groups.map((g) => (
            <section key={g.date} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 px-1 pt-3 pb-1 text-xs text-sq-text-3">
                <span>
                  {g.date} ({g.weekday})
                </span>
                <span>·</span>
                <span>{g.count}件のカルテ</span>
              </div>
              {g.rows.map((row) => (
                <Link
                  key={row.id}
                  href={`/karute/${row.id}` as Parameters<typeof Link>[0]['href']}
                  className="block"
                >
                  <Card interactive className="grid grid-cols-[84px_44px_minmax(0,1.6fr)_minmax(0,1.3fr)_auto] items-center gap-4 px-5 py-4">
                    <div>
                      <div className="text-base font-semibold text-sq-text-1">{row.dateDisplay}</div>
                      <div className="mt-0.5 text-[11px] text-sq-text-3">{row.weekday}</div>
                    </div>
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-sq-pill text-sm font-semibold ${avatarColor(row.id)}`}
                    >
                      {row.customerInitials}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm text-sq-text-1">
                        <strong className="font-semibold">{row.customerName}</strong>
                        <span className="ml-1 font-normal text-sq-text-3">#{row.id.slice(0, 8)}</span>
                      </div>
                      <div className="mt-1 truncate text-[12.5px] text-sq-text-3">{row.summary}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[13px] text-sq-text-1">{row.service}</div>
                      <div className="mt-1 text-[11.5px] text-sq-text-3">
                        {row.duration}分 · {row.entryCount}件のエントリー
                      </div>
                    </div>
                    <Badge
                      tone={aiTone(row)}
                      icon={row.aiStatusTone === 'pending' ? 'clock' : row.aiStatusTone === 'review_needed' ? 'alert' : 'sparkle'}
                      size="sm"
                    >
                      {row.aiStatusLabel}
                    </Badge>
                  </Card>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
