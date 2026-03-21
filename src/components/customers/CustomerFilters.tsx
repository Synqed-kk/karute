'use client'

import { useRouter, usePathname } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'updated_at', label: 'Recent' },
  { value: 'created_at', label: 'Newest' },
  { value: 'created_at_asc', label: 'Oldest' },
]

const TYPE_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'nominated', label: 'Nominated' },
  { value: 'walkin', label: 'Walk-in' },
]

interface CustomerFiltersProps {
  staffList?: { id: string; name: string }[]
}

export function CustomerFilters({ staffList }: CustomerFiltersProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSort = searchParams.get('sort') ?? 'updated_at'
  const currentStaff = searchParams.get('staff') ?? 'all'
  const currentType = searchParams.get('type') ?? 'all'

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === 'all' || !value) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}` as Parameters<typeof router.push>[0])
  }

  function handleSort(sort: string) {
    if (sort.endsWith('_asc')) {
      updateParams({ sort: sort.replace('_asc', ''), order: 'asc' })
    } else {
      updateParams({ sort, order: 'desc' })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Staff filter */}
      {staffList && staffList.length > 0 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>
          <select
            value={currentStaff}
            onChange={(e) => updateParams({ staff: e.target.value })}
            className="bg-transparent text-sm text-foreground focus:outline-none appearance-none cursor-pointer pr-4"
          >
            <option value="all">all</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Sort */}
      <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground"><rect width="18" height="18" x="3" y="4" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
        <select
          value={currentSort}
          onChange={(e) => handleSort(e.target.value)}
          className="bg-transparent text-sm text-foreground focus:outline-none appearance-none cursor-pointer pr-4"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Type toggle pills */}
      <div className="flex items-center">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => updateParams({ type: f.value })}
            className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg border ${
              currentType === f.value
                ? 'bg-foreground text-background border-foreground'
                : 'bg-background text-foreground border-border hover:bg-muted'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  )
}
