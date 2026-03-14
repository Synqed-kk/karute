'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

interface KaruteRecord {
  id: string
  created_at: string
  summary: string | null
  session_date?: string
  staff_profile_id?: string | null
  profiles?: { full_name: string } | null
}

interface KaruteHistoryListProps {
  records: KaruteRecord[]
  currentPage: number
  totalPages: number
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function truncate(text: string | null, maxLen = 100): string {
  if (!text) return ''
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

export function KaruteHistoryList({ records, currentPage, totalPages }: KaruteHistoryListProps) {
  const t = useTranslations('customers')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function navigateToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('historyPage', String(page))
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="rounded-xl border bg-card p-6">
      <h2 className="text-lg font-semibold mb-4">{t('profile.karuteHistory')}</h2>

      {records.length === 0 ? (
        /* Empty state — expected before any karute records exist */
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <FileText className="size-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t('profile.noVisits')}</p>
        </div>
      ) : (
        <>
          {/* Session rows */}
          <div className="divide-y">
            {records.map((record) => (
              <div
                key={record.id}
                className="flex items-start gap-4 py-3 cursor-pointer hover:bg-muted/50 -mx-2 px-2 rounded-lg transition-colors"
                onClick={() => router.push(`/karute/${record.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    router.push(`/karute/${record.id}`)
                  }
                }}
              >
                {/* Date — uses session_date when available, falls back to created_at */}
                <span className="text-sm font-medium shrink-0 w-28">
                  {formatDate(record.session_date ?? record.created_at)}
                </span>

                <span className="text-sm text-muted-foreground shrink-0 w-20">
                  {record.profiles?.full_name ?? t('profile.staff')}
                </span>

                {/* AI summary snippet */}
                <span className="text-sm text-muted-foreground flex-1 min-w-0 truncate">
                  {truncate(record.summary)}
                </span>
              </div>
            ))}
          </div>

          {/* Pagination — only shown when more than 1 page */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={currentPage <= 1}
                onClick={() => navigateToPage(currentPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-4" />
              </Button>

              <span className="text-sm text-muted-foreground">
                {currentPage} / {totalPages}
              </span>

              <Button
                variant="outline"
                size="icon-sm"
                disabled={currentPage >= totalPages}
                onClick={() => navigateToPage(currentPage + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
