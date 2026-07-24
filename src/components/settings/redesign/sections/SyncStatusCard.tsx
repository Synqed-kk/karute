'use client'

// 予約同期 read-only status card (Liam ruling 7/24, packet 31): v2 replaces
// the web-only carve-out (packet 20 §S5) with an actual read for a viewer
// holding the sync.view grant — connected source + relative sync time +
// health, NOTHING clickable (no credential paths; phone re-login is a
// separate PARKED phase). Least-data: `username` never reaches this
// component — the DTO never ships it (see settings-screen-dto.ts).

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { SyncStatusDTO } from '@/lib/app-api/settings-screen-dto'

type Health = 'green' | 'yellow' | 'red'

// QuickReserve's crawler runs on a 15-min cron (synqed-core) — 30/60 min are
// 2x/4x that interval. ANTHONY-CONFIRM: verify the cadence is still 15 min
// before shipping (flag in PR body, packet 31).
const YELLOW_AFTER_MINUTES = 30
const RED_AFTER_MINUTES = 60

const PILL_STYLE: Record<Health, string> = {
  green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  yellow: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
}

/** A reported FAILURE beats a fresh timestamp — RED even 5 minutes after a
 *  failed run. SyncStatus vocabulary is 'OK' | 'ERROR' | 'RUNNING'
 *  (@synqed-kk/client types.d.ts:485). Only 'ERROR' is a failure: 'RUNNING'
 *  is a crawl in flight (written every cycle) — treating it as failure would
 *  flash the card red mid-crawl every 15 minutes on a healthy system, so it
 *  falls through to the time-based read like 'OK'. A crawler that DIED
 *  mid-run leaves 'RUNNING' with an aging timestamp and goes yellow→red
 *  through time, which is the honest signal. */
function syncHealth(status: SyncStatusDTO, nowMs: number): Health {
  if (status.lastRunStatus === 'ERROR') return 'red'
  if (!status.lastRunAt) return 'red'
  const minutes = (nowMs - new Date(status.lastRunAt).getTime()) / 60000
  if (minutes < YELLOW_AFTER_MINUTES) return 'green'
  if (minutes <= RED_AFTER_MINUTES) return 'yellow'
  return 'red'
}

function relativeSync(
  lastRunAt: string | null,
  nowMs: number,
): { value: number; unitKey: 'minutesAgo' | 'hoursAgo' } | null {
  if (!lastRunAt) return null
  const minutes = Math.max(0, Math.floor((nowMs - new Date(lastRunAt).getTime()) / 60000))
  return minutes < 60
    ? { value: minutes, unitKey: 'minutesAgo' }
    : { value: Math.floor(minutes / 60), unitKey: 'hoursAgo' }
}

export function SyncStatusCard({
  status,
  nowMs,
}: {
  status: SyncStatusDTO
  /** Injected clock for deterministic tests; omitted in production, which
   *  falls back to a minute-ticking clock (Greptile #599: a mount-time
   *  snapshot froze health — a card left open crossed the 30/60-min
   *  thresholds while still reporting the stale state). Lazy init keeps
   *  `Date.now()` out of the render body (React purity rule, same idiom as
   *  SubscriptionSummaryCard.tsx's own trial-countdown clock). */
  nowMs?: number
}) {
  const t = useTranslations('settings.sync')
  const [clock, setClock] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const effectiveNow = nowMs ?? clock
  const health = syncHealth(status, effectiveNow)
  const relative = relativeSync(status.lastRunAt, effectiveNow)
  const pillLabel = health === 'green' ? t('healthy') : health === 'yellow' ? t('delayed') : t('stopped')
  // 最終結果 is the run outcome, not health: OK→成功, ERROR→失敗, RUNNING→実行中
  // (a crawl in flight is neither — 失敗 here would be a lie every cycle),
  // never-ran→'—' (plain em dash, no invented state).
  const resultLabel =
    status.lastRunStatus === 'OK'
      ? t('success')
      : status.lastRunStatus === 'ERROR'
        ? t('failure')
        : status.lastRunStatus === 'RUNNING'
          ? t('running')
          : '—'

  return (
    <div className="space-y-6 rounded-xl border border-border/30 bg-card/50 p-6">
      {relative && (
        <div>
          <div className="text-4xl font-bold tabular-nums text-foreground">{relative.value}</div>
          <div className="text-sm text-muted-foreground">{t(relative.unitKey)}</div>
        </div>
      )}

      <span
        className={`inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium ${PILL_STYLE[health]}`}
      >
        {pillLabel}
      </span>

      <div className="divide-y divide-black/5 dark:divide-white/5 rounded-lg border border-border/30">
        <StatusRow label={t('source')} value="Quick Reserve" />
        <StatusRow label={t('autoSync')} value={status.enabled ? t('enabled') : t('disabled')} />
        <StatusRow
          label={t('lastResult')}
          value={resultLabel}
          detail={status.lastRunError ?? undefined}
        />
      </div>

      <p className="text-xs text-muted-foreground">{t('footer')}</p>
    </div>
  )
}

function StatusRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{value}</span>
      </div>
      {detail && <span className="text-xs text-red-600 dark:text-red-400">{detail}</span>}
    </div>
  )
}
