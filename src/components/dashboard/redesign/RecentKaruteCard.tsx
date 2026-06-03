'use client'

import { ArrowRight, Clipboard } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { getStaffColorByKey, type StaffColor } from '@/lib/staff-colors'
import { cn } from '@/lib/utils'

export interface DashboardRecentKarute {
  id: string
  customerName: string
  karuteNumber: string | null
  sessionDate: string // pretty: "Apr 19, 2026"
  summary: string
  entryCount: number
  staffName: string
  staffColorKey: StaffColor['key'] | null
}

export function RecentKaruteCard({
  items,
}: {
  items: DashboardRecentKarute[]
}) {
  const t = useTranslations('dashboard')
  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Clipboard size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('recentKarute')}</h3>
        </div>
        <Link
          href={'/karute' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300"
        >
          <span>{t('viewAll')}</span>
          <ArrowRight size={12} />
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="px-3 py-8 text-center text-xs text-muted-foreground">
          {t('noKaruteYet')}
        </p>
      ) : (
        <div className="flex flex-col">
          {items.map((r) => (
            <Link
              key={r.id}
              href={`/karute/${r.id}` as Parameters<typeof Link>[0]['href']}
              className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 hover:bg-muted/30"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">
                    {r.customerName}
                  </span>
                  {r.karuteNumber && (
                    <span className="rounded border border-border bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">
                      #{r.karuteNumber}
                    </span>
                  )}
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {r.sessionDate}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">
                {r.summary}
              </p>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="tabular-nums">{t('entriesCount', { n: r.entryCount })}</span>
                <span aria-hidden>·</span>
                <span className="flex items-center gap-1.5">
                  {r.staffColorKey && (
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        getStaffColorByKey(r.staffColorKey).stripe,
                      )}
                    />
                  )}
                  <span>{r.staffName}</span>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
