'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface CustomersListPaginationProps {
  /** Total rows after filters/search — NOT the full tenant count. */
  total: number
  /** Current page, 0-indexed. */
  page: number
  /** Rows per page. */
  pageSize: number
  /** Caller manages page state; this component just emits change events. */
  onPageChange: (page: number) => void
}

/**
 * Bottom-of-list pagination — mirrors the design spike:
 *
 *   24名中 1〜12名を表示             [‹ ] [1] [ 2] [ ›]
 *
 * Always renders the "showing X–Y of Z" status text when there is at
 * least one row. Page-number buttons + prev/next arrows only render
 * when there's more than one page worth of results — keeps the
 * footer quiet for small salons (Liam's current 5-customer test
 * data will only see the status text).
 *
 * For large page counts (>7 pages) the middle pages are elided with
 * `…` so the control doesn't grow unboundedly.
 */
export function CustomersListPagination({
  total,
  page,
  pageSize,
  onPageChange,
}: CustomersListPaginationProps) {
  const t = useTranslations('customers.list')
  if (total === 0) return null

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(0, page), totalPages - 1)
  const from = safePage * pageSize + 1
  const to = Math.min((safePage + 1) * pageSize, total)

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 pt-2"
      aria-label="Pagination"
    >
      <p className="text-xs tabular-nums text-muted-foreground">
        {t('paginatedShowing', { from, to, total })}
      </p>

      {totalPages > 1 && (
        <div className="inline-flex items-center gap-1">
          <ArrowButton
            disabled={safePage === 0}
            onClick={() => onPageChange(safePage - 1)}
            ariaLabel={t('previousPage')}
            icon={<ChevronLeft size={14} />}
          />
          {pageRange(safePage, totalPages).map((p, i) =>
            p === '…' ? (
              <span
                key={`gap-${i}`}
                className="px-1 text-xs text-muted-foreground"
                aria-hidden
              >
                …
              </span>
            ) : (
              <PageButton
                key={p}
                page={p}
                active={p === safePage}
                onClick={() => onPageChange(p)}
                ariaLabel={t('goToPage', { n: p + 1 })}
              />
            ),
          )}
          <ArrowButton
            disabled={safePage === totalPages - 1}
            onClick={() => onPageChange(safePage + 1)}
            ariaLabel={t('nextPage')}
            icon={<ChevronRight size={14} />}
          />
        </div>
      )}
    </nav>
  )
}

function PageButton({
  page,
  active,
  onClick,
  ariaLabel,
}: {
  page: number
  active: boolean
  onClick: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={ariaLabel}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-2 text-xs font-medium tabular-nums transition-colors ${
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-foreground hover:bg-muted'
      }`}
    >
      {page + 1}
    </button>
  )
}

function ArrowButton({
  disabled,
  onClick,
  ariaLabel,
  icon,
}: {
  disabled: boolean
  onClick: () => void
  ariaLabel: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card disabled:hover:text-muted-foreground"
    >
      {icon}
    </button>
  )
}

/**
 * Compute the page numbers to render, with `…` for elision when
 * there are many pages. Always shows first + last + 1 page on each
 * side of the active page.
 *
 * Examples (active page in brackets):
 *   3 pages, active 0   → [0] 1 2
 *   10 pages, active 0  → [0] 1 … 9
 *   10 pages, active 4  → 0 … 3 [4] 5 … 9
 *   10 pages, active 9  → 0 … 8 [9]
 */
function pageRange(active: number, total: number): Array<number | '…'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i)
  }
  const out: Array<number | '…'> = []
  const push = (v: number | '…') => {
    if (v === '…' && out[out.length - 1] === '…') return
    out.push(v)
  }
  push(0)
  if (active > 2) push('…')
  for (let p = Math.max(1, active - 1); p <= Math.min(total - 2, active + 1); p++) {
    push(p)
  }
  if (active < total - 3) push('…')
  push(total - 1)
  return out
}
