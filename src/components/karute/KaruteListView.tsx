'use client'

import { useMemo, useState } from 'react'
import {
  ErrorState,
  KaruteListFilterBar,
  KaruteListPageHeader,
  KaruteListRow,
  type KaruteListFilter,
  type KaruteListRowData,
} from '@synqed-kk/ui'
import { Link } from '@/i18n/navigation'

interface KaruteListViewProps {
  rows: KaruteListRowData[]
}

const FILTERS: KaruteListFilter[] = [{ key: 'all', label: 'All' }]

export function KaruteListView({ rows }: KaruteListViewProps) {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        r.customerName.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q),
    )
  }, [rows, search])

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <KaruteListPageHeader
        title="Karute"
        meta={`${rows.length} records`}
        ctaLabel="New karute"
      />

      <KaruteListFilterBar
        filters={FILTERS}
        activeKey="all"
        onChange={() => {}}
        counts={{ all: filtered.length }}
        searchQuery={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search karute…"
      />

      {filtered.length === 0 ? (
        <ErrorState
          error={{ message: 'No karute records yet' }}
          title="Empty"
          helpHint="Records will appear here once a session is recorded."
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-bg-card)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {filtered.map((row) => (
            <KaruteListRow
              key={row.id}
              item={row}
              asLink={(children) => (
                <Link
                  href={
                    `/karute/${row.id}` as Parameters<typeof Link>[0]['href']
                  }
                  className="block"
                >
                  {children}
                </Link>
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
