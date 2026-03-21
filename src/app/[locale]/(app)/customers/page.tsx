import { Suspense } from 'react'
import { getTranslations } from 'next-intl/server'
import { listCustomers } from '@/lib/customers/queries'
import { getStaffList } from '@/lib/staff'
import { CustomerSearch } from '@/components/customers/CustomerSearch'
import { CustomerCards } from '@/components/customers/CustomerCards'
import { CustomerFilters } from '@/components/customers/CustomerFilters'
import { CustomerSheet } from '@/components/customers/CustomerSheet'
import { CustomerEmptyState } from '@/components/customers/CustomerEmptyState'
import { Pagination } from '@/components/customers/Pagination'
import { Skeleton } from '@/components/ui/skeleton'

function CardsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border/30 p-4 flex items-start gap-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; page?: string; sort?: string; order?: string; staff?: string; type?: string }>
}) {
  const params = await searchParams
  const query = params.query ?? ''
  const page = params.page ?? '1'
  const sort = (params.sort ?? 'updated_at') as 'name' | 'updated_at' | 'created_at'
  const order = (params.order ?? 'desc') as 'asc' | 'desc'
  const staffFilter = params.staff ?? ''
  const typeFilter = params.type ?? ''

  const [t, staffList] = await Promise.all([
    getTranslations('customers'),
    getStaffList(),
  ])

  const staffItems = staffList.map((s) => ({ id: s.id, name: s.full_name ?? 'Unknown' }))

  const { customers, totalPages, totalCount } = await listCustomers({
    query,
    page: Number(page),
    pageSize: 12,
    sortBy: sort,
    sortOrder: order,
    staffId: staffFilter,
    customerType: typeFilter,
  })

  const isEmptyState = totalCount === 0 && !query

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{totalCount} customers</p>
        </div>
        <CustomerSheet />
      </div>

      {/* Search + Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <CustomerSearch />
        </div>
        <CustomerFilters staffList={staffItems} />
      </div>

      {/* Content */}
      {isEmptyState ? (
        <CustomerEmptyState />
      ) : (
        <>
          <Suspense key={query + page + sort} fallback={<CardsSkeleton />}>
            <CustomerCards customers={customers} />
          </Suspense>

          <Pagination currentPage={Number(page)} totalPages={totalPages} />
        </>
      )}
    </div>
  )
}
