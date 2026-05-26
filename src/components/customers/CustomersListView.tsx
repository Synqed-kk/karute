'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import {
  CustomerRow,
  CustomersFilterBar,
  CustomersListSkeleton,
  CustomersPageHeader,
  ErrorState,
  Pagination,
  type CustomerRowData,
  type CustomersFilter,
} from '@synqed-kk/ui'
import { Link } from '@/i18n/navigation'
import { CustomerSheet } from '@/components/customers/CustomerSheet'

interface CustomersListViewProps {
  rows: CustomerRowData[]
  totalCount: number
  page: number
  pageSize: number
  query: string
}

const FILTERS: CustomersFilter[] = [{ key: 'all', label: 'All' }]

export function CustomersListView({
  rows,
  totalCount,
  page,
  pageSize,
  query,
}: CustomersListViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [searchInput, setSearchInput] = useState(query)

  const updateParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString())
      mutate(params)
      const next = params.toString()
      startTransition(() => {
        router.replace(next ? `${pathname}?${next}` : pathname)
      })
    },
    [router, pathname, searchParams],
  )

  const handleSearch = useDebouncedCallback((value: string) => {
    updateParams((params) => {
      if (value.trim()) params.set('query', value.trim())
      else params.delete('query')
      params.delete('page')
    })
  }, 300)

  const handlePageChange = (next: number) => {
    updateParams((params) => {
      params.set('page', String(next))
    })
  }

  const counts = { all: totalCount }

  const meta = `Registered ${totalCount} · Showing ${rows.length}`

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <CustomersPageHeader
        title="Customers"
        meta={meta}
        ctaLabel="New customer"
        ctaSlot={<CustomerSheet />}
      />

      <CustomersFilterBar
        filters={FILTERS}
        activeKey="all"
        onChange={() => {}}
        counts={counts}
        searchQuery={searchInput}
        onSearchChange={(v) => {
          setSearchInput(v)
          handleSearch(v)
        }}
        searchPlaceholder="Search customers…"
      />

      {pending ? (
        <CustomersListSkeleton rows={Math.min(8, pageSize)} />
      ) : rows.length === 0 ? (
        <ErrorState
          error={{ message: query ? `No customers match “${query}”` : 'No customers yet' }}
          title="Empty"
          helpHint="Add a new customer to get started."
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-bg-card)] ring-1 ring-black/5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {rows.map((row) => (
            <CustomerRow
              key={row.id}
              customer={row}
              asLink={(children) => (
                <Link
                  href={
                    `/customers/${row.id}` as Parameters<typeof Link>[0]['href']
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

      <Pagination
        currentPage={page}
        pageSize={pageSize}
        totalItems={totalCount}
        onPageChange={handlePageChange}
      />
    </div>
  )
}
