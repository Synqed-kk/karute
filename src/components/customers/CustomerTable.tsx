'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { getAvatarColor, getInitials } from '@/lib/customers/utils'
import type { Customer } from '@/types/database'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortableColumn = 'name' | 'updated_at'

interface CustomerTableProps {
  customers: Customer[]
  currentSort: string
  currentOrder: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortIndicator({
  column,
  currentSort,
  currentOrder,
}: {
  column: SortableColumn
  currentSort: string
  currentOrder: string
}) {
  if (currentSort !== column) {
    return <span className="ml-1 size-3 opacity-30 inline-block"><ChevronUp className="size-3" /></span>
  }
  return currentOrder === 'asc' ? (
    <ChevronUp className="ml-1 size-3" />
  ) : (
    <ChevronDown className="ml-1 size-3" />
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CustomerTable({ customers, currentSort, currentOrder }: CustomerTableProps) {
  const t = useTranslations('customers')
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  function handleSort(column: SortableColumn) {
    const params = new URLSearchParams(searchParams.toString())
    const nextOrder =
      currentSort === column && currentOrder === 'asc' ? 'desc' : 'asc'
    params.set('sort', column)
    params.set('order', nextOrder)
    params.delete('page') // reset to page 1 on sort change
    router.replace(`${pathname}?${params.toString()}`)
  }

  function handleRowClick(customerId: string) {
    router.push(`/customers/${customerId}`)
  }

  if (customers.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
        {t('table.noResults')}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        {/* Header */}
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {/* Name — sortable */}
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              <button
                className="inline-flex items-center hover:text-foreground transition-colors"
                onClick={() => handleSort('name')}
              >
                {t('table.name')}
                <SortIndicator
                  column="name"
                  currentSort={currentSort}
                  currentOrder={currentOrder}
                />
              </button>
            </th>

            {/* Contact */}
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              {t('table.contact')}
            </th>

            {/* Last Visit — sortable (via updated_at proxy) */}
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              <button
                className="inline-flex items-center hover:text-foreground transition-colors"
                onClick={() => handleSort('updated_at')}
              >
                {t('table.lastVisit')}
                <SortIndicator
                  column="updated_at"
                  currentSort={currentSort}
                  currentOrder={currentOrder}
                />
              </button>
            </th>

            {/* Visits */}
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              {t('table.visitCount')}
            </th>
          </tr>
        </thead>

        {/* Body */}
        <tbody>
          {customers.map((customer) => {
            const { bg, text } = getAvatarColor(customer.id)
            const initials = getInitials(customer.name)

            return (
              <tr
                key={customer.id}
                className={cn(
                  'border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors'
                  // No cursor-pointer per user decision
                )}
                onClick={() => handleRowClick(customer.id)}
              >
                {/* Name + avatar */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {/* Initials avatar */}
                    <div
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        bg,
                        text
                      )}
                    >
                      {initials}
                    </div>

                    {/* Name + furigana */}
                    <div>
                      <div className="font-medium">{customer.name}</div>
                      {customer.furigana && (
                        <div className="text-xs text-muted-foreground">
                          {customer.furigana}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Contact */}
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-0.5 text-muted-foreground">
                    {customer.phone && <span>{customer.phone}</span>}
                    {customer.email && <span>{customer.email}</span>}
                    {!customer.phone && !customer.email && <span>-</span>}
                  </div>
                </td>

                {/* Last Visit (updated_at proxy) */}
                <td className="px-4 py-3 text-muted-foreground">
                  {formatDate(customer.updated_at)}
                </td>

                {/* Visits (placeholder until Phase 4) */}
                <td className="px-4 py-3 text-muted-foreground">
                  0
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
