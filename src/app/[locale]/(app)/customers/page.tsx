import { listCustomers } from '@/lib/customers/queries'
import { customersToRowData } from '@/lib/adapters/customers-list'
import { CustomersListView } from '@/components/customers/CustomersListView'

const PAGE_SIZE = 12

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string
    page?: string
    sort?: string
    order?: string
  }>
}) {
  const params = await searchParams
  const query = params.query ?? ''
  const page = Number(params.page ?? '1')
  const sort = (params.sort ?? 'updated_at') as
    | 'name'
    | 'updated_at'
    | 'created_at'
  const order = (params.order ?? 'desc') as 'asc' | 'desc'

  const { customers, totalCount } = await listCustomers({
    query,
    page,
    pageSize: PAGE_SIZE,
    sortBy: sort,
    sortOrder: order,
  })

  const rows = customersToRowData(customers)

  return (
    <CustomersListView
      rows={rows}
      totalCount={totalCount}
      page={page}
      pageSize={PAGE_SIZE}
      query={query}
    />
  )
}
