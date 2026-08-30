'use client'

// 破棄の記録 — the manager read of why recordings were thrown away (packet
// P5-A item A-6, built to the approved mock mock-a6-discard-reasons-2026-08-25).
//
// THE POINT: P5-A makes every deliberate discard demand a written reason. A
// required explanation that nobody can ever read is a toll, not a record — so
// the friction and this screen ship together. The receipt's `discard_row_id`
// points at the row whose text is rendered here; the text itself never enters
// an audit detail (⚖ 8/17 doc law), which is exactly why this read exists.
//
// RENDERING LAW (⚖ 8/25 ruling B): the counts are LABELLED PLAIN FACTS —
// 「今月の破棄 6件」 says what it counts, in neutral type. No red, no
// threshold, no grade, no ranking colour, no "high" badge. Liam's rule is that
// a discard count must never be the thing that makes a staff member hesitate to
// discard a recording they should discard. Same reason there is no sorting
// control that would turn the per-staff list into a leaderboard.
//
// NOT IN THIS ROUND (deferred with the transcript view, packet item A2-4):
// the ✓確認済み mark and the 録音内容なし empty state, and the mock's
// per-row duration + customer name. The first two pair with the opened-row
// transcript the mock shows below the list. The last two are not on
// `recordingDiscards.list` — the SDK row carries id / session / source /
// discarded_by / reason / created_at only, so rendering them would cost one
// `recordings.get` per row (an N+1 on a screen whose whole job is a list).

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import {
  listDiscardReasons,
  type DiscardReasonCounts,
  type DiscardReasonRow,
} from '@/actions/recording-discards'

export function DiscardReasonsSection() {
  const t = useTranslations('settings.discardReasons')
  const locale = useLocale()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; rows: DiscardReasonRow[]; counts: DiscardReasonCounts; truncated: boolean }
  >({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    void listDiscardReasons().then(
      (res) => {
        if (!alive) return
        setState(
          res.ok
            ? { kind: 'ready', rows: res.rows, counts: res.counts, truncated: res.truncated }
            : { kind: 'error' },
        )
      },
      // A server action can fail at the TRANSPORT layer (offline, a 500 from
      // the action endpoint, a deploy mid-flight) — that rejects instead of
      // resolving { ok: false }. Fulfillment-only, this screen sat on its
      // spinner forever. A failure is a failure: same error state either way.
      () => {
        if (!alive) return
        setState({ kind: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const fmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t('description')}</p>
      </div>

      {state.kind === 'loading' && (
        <div className="flex items-center gap-2 px-1 py-6 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('loading')}
        </div>
      )}

      {state.kind === 'error' && (
        <p className="rounded-xl border border-border bg-card px-4 py-6 text-xs text-muted-foreground">
          {t('loadFailed')}
        </p>
      )}

      {state.kind === 'ready' && (
        <>
          {/* Labelled plain facts. Each number says WHAT it counts — never a
              bare figure the reader has to interpret, and past the read cap
              that includes saying the older records are not in it. */}
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground">
              {t('countThisMonth', { count: state.counts.thisMonth })}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('countTotal', { count: state.counts.total })}
            </p>
            {state.truncated && (
              <p className="w-full text-[11px] text-muted-foreground">{t('countsTruncated')}</p>
            )}
          </div>

          {state.counts.byStaff.length > 0 && (
            <div className="rounded-xl border border-border bg-card px-4 py-3">
              <p className="text-xs font-medium text-foreground">{t('byStaffTitle')}</p>
              <ul className="mt-2 space-y-1">
                {state.counts.byStaff.map((s) => (
                  <li
                    key={s.staffId}
                    className="flex items-baseline justify-between gap-4 text-xs text-muted-foreground"
                  >
                    <span>{s.staffName ?? t('unknownStaff')}</span>
                    <span>{t('countThisMonth', { count: s.thisMonth })}</span>
                  </li>
                ))}
              </ul>
              {state.truncated && (
                <p className="mt-2 text-[11px] text-muted-foreground">{t('countsTruncated')}</p>
              )}
            </div>
          )}

          {state.rows.length === 0 ? (
            <p className="rounded-xl border border-border bg-card px-4 py-6 text-xs text-muted-foreground">
              {t('empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card">
              {state.rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="text-xs text-muted-foreground">
                      {fmt.format(new Date(r.createdAt))}
                    </span>
                    <span className="text-xs font-medium text-foreground">
                      {r.staffName ?? t('unknownStaff')}
                    </span>
                  </div>
                  {/* The whole reason, never truncated: a manager reading half
                      an explanation is the failure this screen exists to fix. */}
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                    {r.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {state.truncated && (
            <p className="px-1 text-[11px] text-muted-foreground">{t('truncated')}</p>
          )}
        </>
      )}
    </div>
  )
}
