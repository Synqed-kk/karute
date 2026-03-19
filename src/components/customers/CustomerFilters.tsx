'use client'

import { useRouter, usePathname } from '@/i18n/navigation'
import { useSearchParams } from 'next/navigation'

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'updated_at', label: 'Recent' },
  { value: 'created_at', label: 'Newest' },
  { value: 'created_at_asc', label: 'Oldest' },
]

export function CustomerFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentSort = searchParams.get('sort') ?? 'updated_at'

  function handleSort(sort: string) {
    const params = new URLSearchParams(searchParams.toString())
    // Handle _asc suffix for ascending order
    if (sort.endsWith('_asc')) {
      params.set('sort', sort.replace('_asc', ''))
      params.set('order', 'asc')
    } else {
      params.set('sort', sort)
      params.set('order', 'desc')
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}` as Parameters<typeof router.push>[0])
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Sort:</span>
      {SORT_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => handleSort(opt.value)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            currentSort === opt.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
