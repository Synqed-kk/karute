// 推奨アクション (from Liam's Reserve design spike) — the AI/data layer
// proposes MOVES, not summaries: today's renewal moment, rebook suggestions
// computed from each customer's real visit rhythm, and win-back candidates.
// Every card hides when it has nothing; the whole section renders null when
// all three are empty. Staff-safe: names and counts only, never yen.

import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export interface RenewalView {
  clientId: string
  name: string
  timeHm: string
  cycle: number | null
}

export interface RebookView {
  clientId: string
  name: string
  remaining: number
  dueLabel: string
}

export interface WinbackView {
  clientId: string
  name: string
  remaining: number
  days: number
}

export async function ActionCards({
  renewals,
  rebooks,
  winbacks,
}: {
  renewals: RenewalView[]
  rebooks: RebookView[]
  winbacks: WinbackView[]
}) {
  const t = await getTranslations('dashboard.flow')
  if (renewals.length === 0 && rebooks.length === 0 && winbacks.length === 0) return null
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="px-1 text-sm font-semibold">{t('actionsTitle')}</h2>

      {renewals.map((r) => (
        <div
          key={r.clientId}
          className="rounded-r-2xl border border-l-[3px] border-border border-l-amber-400 bg-card p-3"
        >
          <p className="text-[13px] font-medium">{t('renewalTitle', { name: r.name })}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {r.cycle
              ? t('renewalBodyCycle', { cycle: r.cycle, time: r.timeHm })
              : t('renewalBody', { time: r.timeHm })}
          </p>
          <Link
            href={`/customers/${r.clientId}`}
            className="mt-1.5 inline-block text-xs font-medium text-primary hover:underline"
          >
            {t('openCustomer')} ›
          </Link>
        </div>
      ))}

      {rebooks.length > 0 && (
        <div className="rounded-r-2xl border border-l-[3px] border-border border-l-emerald-500 bg-card p-3">
          <p className="text-[13px] font-medium">{t('rebookTitle', { n: rebooks.length })}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {rebooks.map((b, i) => (
              <span key={b.clientId}>
                {i > 0 && ' ・ '}
                <Link href={`/customers/${b.clientId}`} className="hover:underline">
                  {t('rebookItem', { name: b.name, remaining: b.remaining, due: b.dueLabel })}
                </Link>
              </span>
            ))}
          </p>
        </div>
      )}

      {winbacks.length > 0 && (
        <div className="rounded-r-2xl border border-l-[3px] border-border border-l-slate-400 bg-card p-3">
          <p className="text-[13px] font-medium">{t('winbackTitle', { n: winbacks.length })}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {winbacks.map((w, i) => (
              <span key={w.clientId}>
                {i > 0 && ' ・ '}
                <Link href={`/customers/${w.clientId}`} className="hover:underline">
                  {t('winbackItem', { name: w.name, remaining: w.remaining, days: w.days })}
                </Link>
              </span>
            ))}
            {' — '}
            {t('winbackBody')}
          </p>
        </div>
      )}

      <p className="px-1 text-[11px] text-muted-foreground">{t('actionsFootnote')}</p>
    </section>
  )
}
