'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { SyncStoreRow } from '@/app/api/sync/quickreserve/configs/route'
import { syncFailureReason, syncStoreState, type SyncFailureReason, type SyncStoreState } from '@/lib/sync/sync-store-state'
import { readSyncResponse } from '@/lib/sync/read-sync-response'

type RunOutcome =
  | { ok: true; created: number; updated: number; cancelled: number; skipped: number }
  | { ok: false; reason: SyncFailureReason }

const STATE_KEY: Record<SyncStoreState, string> = {
  notSet: 'stateNotSet',
  waiting: 'stateWaiting',
  healthy: 'stateHealthy',
  delayed: 'stateDelayed',
  stopped: 'stateStopped',
}
// Status colours (SyncStatusCard's washes); waiting is neutral.
const STATE_TONE: Record<SyncStoreState, string> = {
  notSet: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  waiting: 'bg-muted text-muted-foreground border-border',
  healthy: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  delayed: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  stopped: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
}
// The state re-reads the clock this often while the list is mounted, so a tab
// left open moves 正常 → 遅れ → 停止 on its own.
const RETICK_MS = 60_000
const OUTLINE_BUTTON =
  'rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50'

/** One store's 今すぐ同期 through PR-A's run route, which resolves the named
 *  store with the shared resolver (resolveSyncRunStore). */
export async function runStoreSync(storeId: string): Promise<RunOutcome> {
  try {
    const res = await getDataPort().apiFetch('/api/sync/quickreserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    })
    const parsed = await readSyncResponse(res)
    if (!parsed.ok) return { ok: false, reason: syncFailureReason(parsed.message) }
    const d = parsed.data as { message?: string; created?: number; updated?: number; cancelled?: number; skipped?: number }
    // A 2xx { message } is the route's "not configured" answer — not a run.
    if (d.message) return { ok: false, reason: 'other' }
    return { ok: true, created: d.created ?? 0, updated: d.updated ?? 0, cancelled: d.cancelled ?? 0, skipped: d.skipped ?? 0 }
  } catch {
    return { ok: false, reason: 'other' }
  }
}

/** ⚖ Store isolation law: render this ONLY for stores.viewAll callers — it
 *  names every store. Everyone else keeps the single-store form alone. */
export function SyncAllStoresList({
  selectStore,
}: {
  /** setActiveStore (server action, handed down from the settings page). */
  selectStore: (storeId: string) => Promise<{ ok: true } | { error: string }>
}) {
  const t = useTranslations('syncAllStores')
  const tCommon = useTranslations('common')
  const locale = useLocale()
  const router = useRouter()
  const [rows, setRows] = useState<SyncStoreRow[] | null>(null)
  const [now, setNow] = useState(0)
  const [running, setRunning] = useState<Record<string, boolean>>({})
  const [rowResult, setRowResult] = useState<Record<string, RunOutcome>>({})
  const [runAll, setRunAll] = useState<{ pending: boolean; results: { row: SyncStoreRow; outcome: RunOutcome }[] | null }>({
    pending: false,
    results: null,
  })
  const [selectFailed, setSelectFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await getDataPort().apiFetch('/api/sync/quickreserve/configs')
      if (!res.ok) return
      const data = (await res.json()) as { stores?: SyncStoreRow[] }
      setRows(data.stores ?? [])
      setNow(Date.now())
    } catch {
      /* the per-store form below still works */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), RETICK_MS)
    return () => clearInterval(id)
  }, [])

  // 編集 / 設定する select the store the same way the store switcher does
  // (cookie + refresh), so SyncSection's storeId changes and the form reloads
  // for that store — first-save fields when it has no config yet.
  // A refused or failed selection shows the surface's generic error line.
  async function editStore(storeId: string) {
    setSelectFailed(false)
    try {
      const res = await selectStore(storeId)
      if ('error' in res) setSelectFailed(true)
      else router.refresh()
    } catch {
      setSelectFailed(true)
    }
  }

  // ⚖ Never two crawls of one store at once: a row run and すべての店舗を同期
  // lock each other out.
  const anyRowRunning = Object.values(running).some(Boolean)

  async function runOne(row: SyncStoreRow) {
    if (runAll.pending || running[row.storeId]) return
    setRunning((r) => ({ ...r, [row.storeId]: true }))
    const outcome = await runStoreSync(row.storeId)
    setRowResult((r) => ({ ...r, [row.storeId]: outcome }))
    setRunning((r) => ({ ...r, [row.storeId]: false }))
    await load()
  }

  // One store at a time, never in parallel against Quick Reserve; a failure
  // never stops the next store. Only stores whose auto-sync is ON: an owner
  // who turned a store OFF is not overridden by a bulk click (the row's own
  // 今すぐ同期 stays, a deliberate single action).
  async function runAllStores() {
    if (!rows || runAll.pending || anyRowRunning) return
    setRunAll({ pending: true, results: null })
    const results: { row: SyncStoreRow; outcome: RunOutcome }[] = []
    for (const row of rows.filter(syncsInRunAll)) {
      results.push({ row, outcome: await runStoreSync(row.storeId) })
    }
    setRowResult({})
    setRunAll({ pending: false, results })
    await load()
  }

  if (!rows) return null
  const runAllCount = rows.filter(syncsInRunAll).length
  const reasonText = (r: SyncFailureReason) =>
    r === 'login' ? t('reasonLogin') : r === 'store' ? t('reasonStore') : null
  const fixText = (r: SyncFailureReason) =>
    r === 'login' ? t('reasonLoginFix') : r === 'store' ? t('reasonStoreFix') : t('runFailed')
  const successText = (o: Extract<RunOutcome, { ok: true }>) =>
    t('runResult', { created: o.created, updated: o.updated, cancelled: o.cancelled, skipped: o.skipped })
  const failed = runAll.results?.filter((x) => !x.outcome.ok).length ?? 0

  return (
    <section className="space-y-3" aria-labelledby="sync-all-stores-title">
      <div>
        <h4 id="sync-all-stores-title" className="text-sm font-medium">{t('blockTitle')}</h4>
        <p className="text-xs text-muted-foreground mt-0.5">{t('blockNote')}</p>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{t('scopeLine', { n: rows.length })}</span>
        {runAllCount >= 2 && (
          <button type="button" onClick={runAllStores} disabled={runAll.pending || anyRowRunning} className={OUTLINE_BUTTON}>
            {runAll.pending ? t('runNowPending') : t('runAll')}
          </button>
        )}
      </div>

      {selectFailed && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {tCommon('somethingWentWrong')}
        </p>
      )}

      {runAll.results && (
        <div
          role="status"
          className={`rounded-lg px-4 py-3 text-sm border ${
            failed
              ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
          }`}
        >
          <p className="font-medium">
            {failed
              ? t('runAllPartial', { total: runAll.results.length, failed })
              : t('runAllDone', { n: runAll.results.length })}
          </p>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            {runAll.results.map(({ row, outcome }) => (
              <li key={row.storeId} data-testid={`run-all-result-${row.storeId}`}>
                <span className="font-medium">{row.storeName}</span>{' '}
                {outcome.ok
                  ? successText(outcome)
                  : reasonText(outcome.reason)
                    ? t('resultFailed', { reason: reasonText(outcome.reason)! })
                    : t('runFailed')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm" aria-labelledby="sync-all-stores-title">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
              <th className="px-3 py-2 font-semibold">{t('colStore')}</th>
              <th className="px-3 py-2 font-semibold">{t('colQrStore')}</th>
              <th className="px-3 py-2 font-semibold">{t('colState')}</th>
              <th className="px-3 py-2 font-semibold">{t('colLastRun')}</th>
              <th className="px-3 py-2 font-semibold">
                <span className="block">{t('colInterval')}</span>
                <span className="block">{t('colWindow')}</span>
              </th>
              <th className="px-3 py-2 font-semibold">{t('colActions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((row) => {
              const { state, reason } = syncStoreState(row, now)
              const result = rowResult[row.storeId]
              const pending = Boolean(running[row.storeId])
              const rowMessage = pending || runAll.pending
                ? null
                : result
                  ? result.ok
                    ? { ok: true, text: successText(result) }
                    : { ok: false, text: fixText(result.reason) }
                  : row.configured && row.lastRunStatus === 'ERROR'
                    ? { ok: false, text: fixText(row.lastRunReason ?? 'other') }
                    : reason === 'window_empty'
                      ? { ok: false, text: t('windowEmpty') }
                      : null
              return (
                <tr key={row.storeId} data-testid={`sync-row-${row.storeId}`} className="align-top">
                  <td className="px-3 py-2.5 font-medium">{row.storeName}</td>
                  <td className="px-3 py-2.5">
                    {row.configured ? (
                      <>
                        <span className="block">{row.qrStoreSlug ?? t('none')}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">
                          {row.qrStoreId != null ? t('storeNoCell', { id: row.qrStoreId }) : t('none')}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('none')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_TONE[state]}`}>
                      {t(STATE_KEY[state])}
                    </span>
                    {rowMessage && (
                      <span
                        role="status"
                        className={`mt-1 block text-xs ${rowMessage.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}
                      >
                        {rowMessage.text}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    <LastRunCell row={row} pending={pending || (runAll.pending && row.configured)} now={now} locale={locale} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {row.schedule ? (
                      <>
                        <span className="block">{t('everyMinutes', { minutes: row.schedule.intervalMinutes })}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t('hours', { start: row.schedule.hoursStart, end: row.schedule.hoursEnd })}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('none')}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void editStore(row.storeId)}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {row.configured ? t('edit') : t('setUp')}
                      </button>
                      {row.configured && (
                        <button
                          type="button"
                          onClick={() => void runOne(row)}
                          disabled={pending || runAll.pending}
                          className={OUTLINE_BUTTON}
                        >
                          {pending ? t('runNowPending') : t('runNow')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('footnote')}</p>
    </section>
  )
}

const syncsInRunAll = (r: SyncStoreRow) => r.configured && r.enabled

/** 最終同期 as the mock's bLastCell: 同期中… while a run is pending; the
 *  not-registered fact; まだ同期していません; else the time (今日 {time} on the
 *  store's today, a short date otherwise) over 失敗 or the run's counts. */
function LastRunCell({ row, pending, now, locale }: { row: SyncStoreRow; pending: boolean; now: number; locale: string }) {
  const t = useTranslations('syncAllStores')
  const sub = 'block text-xs text-muted-foreground'
  if (pending) return <span className={sub}>{t('runNowPending')}</span>
  if (!row.configured || !row.schedule) return <span className={sub}>{t('notSetFact')}</span>
  if (!row.lastRunAt) return <span className={sub}>{t('neverRun')}</span>
  const at = new Date(row.lastRunAt)
  const timeZone = row.schedule.timezone
  const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone })
  const when =
    now && day(at) === day(new Date(now))
      ? t('lastRunToday', { time: at.toLocaleTimeString(locale, { timeZone, hour: '2-digit', minute: '2-digit' }) })
      : at.toLocaleString(locale, { timeZone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <>
      <span className="block font-medium">{when}</span>
      {row.lastRunStatus === 'ERROR' ? (
        <span className="block text-xs text-red-600 dark:text-red-400">{t('lastRunFailed')}</span>
      ) : row.lastRunCounts ? (
        <span className={sub}>{t('lastRunCounts', row.lastRunCounts)}</span>
      ) : null}
    </>
  )
}
