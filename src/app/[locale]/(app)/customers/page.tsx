import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { listCustomers } from '@/lib/customers/queries'
import { CustomerSearch } from '@/components/customers/CustomerSearch'
import { CustomerTable } from '@/components/customers/CustomerTable'
import { CustomerSheet } from '@/components/customers/CustomerSheet'
import { CustomerEmptyState } from '@/components/customers/CustomerEmptyState'
import { Pagination } from '@/components/customers/Pagination'
import { Skeleton } from '@/components/ui/skeleton'

// ---------------------------------------------------------------------------
// Skeleton used inside Suspense boundary
// ---------------------------------------------------------------------------

function CustomerTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string; sort?: string; order?: string }>
}) {
  const params = await searchParams
  const query = params.query ?? ''
  const page = params.page ?? '1'
  const sort = (params.sort ?? 'updated_at') as 'name' | 'updated_at' | 'created_at'
  const order = (params.order ?? 'desc') as 'asc' | 'desc'

  const t = await getTranslations('customers')

  const { customers, totalPages, totalCount } = await listCustomers({
    query,
    page: Number(page),
    pageSize: 10,
    sortBy: sort,
    sortOrder: order,
  })

  // Show empty state when no customers at all (not even from a search)
  const isEmptyState = totalCount === 0 && !query

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <CustomerSheet />
      </div>

      {/* Search */}
      <CustomerSearch />

      {/* Content */}
      {isEmptyState ? (
        <CustomerEmptyState />
      ) : (
        <>
          <Suspense key={query + page} fallback={<CustomerTableSkeleton />}>
            <CustomerTable
              customers={customers}
              currentSort={sort}
              currentOrder={order}
            />
          </Suspense>

          <Pagination currentPage={Number(page)} totalPages={totalPages} />
        </>
      )}
    </div>
  )
}
