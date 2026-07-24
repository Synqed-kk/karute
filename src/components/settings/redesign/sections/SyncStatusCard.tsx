'use client'

// 予約同期 status card (Liam ruling 7/24, packet 31 → packet 32): v2 replaced
// the web-only carve-out (packet 20 §S5) with an actual read for a viewer
// holding the sync.view grant — connected source + relative sync time +
// health. Packet 32 adds exactly ONE action on top: 今すぐ同期 (trigger an
// immediate crawl instead of waiting for the 15-min cron) via the optional
// `onRunNow` prop. Credential paths stay sealed (no username, no re-login) —
// this is a trigger, not a config write. Least-data: `username` never
// reaches this component — the DTO never ships it (see
// settings-screen-dto.ts). `onRunNow` absent (web today) → the card renders
// ZERO interactive elements, byte-identical to the packet-31 read-only card;
// only the thin caller (with the sync.view grant) ever passes it.

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
  onRunNow,
}: {
  status: SyncStatusDTO
  /** Injected clock for deterministic tests; omitted in production, which
   *  falls back to a minute-ticking clock (Greptile #599: a mount-time
   *  snapshot froze health — a card left open crossed the 30/60-min
   *  thresholds while still reporting the stale state). Lazy init keeps
   *  `Date.now()` out of the render body (React purity rule, same idiom as
   *  SubscriptionSummaryCard.tsx's own trial-countdown clock). */
  nowMs?: number
  /** 今すぐ同期 (packet 32). PRESENCE gates the button, same idiom as
   *  webOnlyTabIds/syncStatus elsewhere in this shell — omitted (web today)
   *  → zero interactive elements. Resolves to `{ ok }` on success (incl. a
   *  friendly not-configured message, which still counts as ok — the run
   *  attempted, nothing failed) or `{ ok: false, message }` on failure;
   *  never expected to reject (the thin wiring catches its own network
   *  errors), but a throw would just surface as an unhandled state, same as
   *  any other event handler. */
  onRunNow?: () => Promise<{ ok: boolean; message?: string }>
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
  const [pending, setPending] = useState(false)
  const [runResult, setRunResult] = useState<{ text: string; isError: boolean } | null>(null)

  async function handleRunNow() {
    if (!onRunNow || pending) return
    setPending(true)
    setRunResult(null)
    try {
      const result = await onRunNow()
      if (!result.ok) {
        setRunResult({ text: result.message ?? t('runFailed'), isError: true })
      } else if (result.message) {
        // A friendly message (e.g. not-configured) rides through as ok:true —
        // it's not an error, but it's worth telling the owner why nothing ran.
        setRunResult({ text: result.message, isError: false })
      } else {
        setRunResult(null)
      }
    } catch {
      // The thin wiring's contract is never-reject, but a stuck-disabled
      // 同期中… button is too bad a failure mode to leave to a contract.
      setRunResult({ text: t('runFailed'), isError: true })
    } finally {
      setPending(false)
    }
  }
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
      {/* Mock layout (Liam-approved, field report 7/24): relative time and
          the health pill share ONE row — number + unit baseline-aligned
          left, pill right. Never-synced keeps the pill right-aligned. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {relative ? (
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums text-foreground">
              {relative.value}
            </span>
            <span className="text-sm text-muted-foreground">{t(relative.unitKey)}</span>
          </div>
        ) : (
          <span />
        )}
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-3 py-1.5 text-xs font-medium ${PILL_STYLE[health]}`}
        >
          {pillLabel}
        </span>
      </div>

      <div className="divide-y divide-black/5 dark:divide-white/5 rounded-lg border border-border/30">
        <StatusRow label={t('source')} value="Quick Reserve" />
        <StatusRow label={t('autoSync')} value={status.enabled ? t('enabled') : t('disabled')} />
        <StatusRow
          label={t('lastResult')}
          value={resultLabel}
          detail={status.lastRunError ?? undefined}
        />
      </div>

      {onRunNow && (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={handleRunNow}
            disabled={pending}
            className="w-full rounded-lg border border-border py-2 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            {pending ? t('runNowPending') : t('runNow')}
          </button>
          {runResult && (
            <p
              className={`text-xs ${
                runResult.isError ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
              }`}
            >
              {runResult.text}
            </p>
          )}
        </div>
      )}

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
