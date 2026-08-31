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
// A2-4 (packet P5-A2): a row OPENS onto the transcript of what was thrown away
// — read lazily, one row at a time, so the list itself never pays an N+1 for
// text nobody has asked for. ⚖ 8/25 ruling A: the written reason is the
// staffer's CLAIM and the transcript is what a manager checks it against, so
// they are read side by side, in the same row.
//
// ABSENCE IS NEVER A PLACEHOLDER. Three honest answers, no invention: the words
// when they were kept, "the recording was never transcribed" when the take was
// under the accidental-tap floor (the ⚖ spend gate — a fact about what was
// done, not about what survived), and a plain "there is no transcript" for
// everything else (a discard from before A2-2, a customer who never consented,
// a session row already swept). None of them says the words were LOST: three of
// those four populations never had any. And a read that failed is none of the
// three — it says so on its own, because "we could not look" is not an answer
// about the words (getDiscardTranscript refuses to turn one into the other).
//
// NOT IN THIS ROUND: the ✓確認済み mark (the SDK's discard row has no update
// surface — create/list only, verified 1.28.0, so it has no durable home), and
// the mock's per-row duration + customer name (not on `recordingDiscards.list`,
// which carries id / session / source / discarded_by / reason / created_at only).

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import {
  listDiscardReasons,
  getDiscardTranscript,
  type DiscardReasonCounts,
  type DiscardReasonRow,
} from '@/actions/recording-discards'
import { BELOW_FLOOR_SEC } from '@/lib/recording/discard-floor'

type TranscriptState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; segments: { text: string }[]; durationSeconds: number | null }

export function DiscardReasonsSection() {
  const t = useTranslations('settings.discardReasons')
  const tc = useTranslations('common')
  const locale = useLocale()
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'ready'; rows: DiscardReasonRow[]; counts: DiscardReasonCounts; truncated: boolean }
  >({ kind: 'loading' })
  /** Bumped by the error state's retry — the load effect below re-runs on it.
   *  On the COMPUTER a failed load has the browser's own reload behind it; on
   *  the phone this section is a tab inside a shell that never reloads, so
   *  without this the only recovery was switching tabs and back, which nobody
   *  would guess. Re-running the effect (rather than calling the read inline)
   *  keeps ONE read path and lets the cleanup below do its job: the previous
   *  attempt's `alive` flips false, so a slow first answer can never overwrite
   *  a newer one, however many times the button is pressed. */
  const [attempt, setAttempt] = useState(0)
  /** One row open at a time — the transcript is read to be read, not skimmed. */
  const [openId, setOpenId] = useState<string | null>(null)
  /** Kept per row once fetched: re-opening a row must not re-read core. */
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptState>>({})

  function toggleRow(row: DiscardReasonRow) {
    const next = openId === row.id ? null : row.id
    setOpenId(next)
    // A cached SUCCESS is kept — re-opening a row must not re-read core. A
    // cached ERROR is not an answer, so re-opening retries it: the row is the
    // only retry affordance this screen has, and a failure that stuck until a
    // full page reload read as a settled outcome.
    const cached = transcripts[row.id]
    if (!next || (cached && cached.kind !== 'error')) return
    setTranscripts((prev) => ({ ...prev, [row.id]: { kind: 'loading' } }))
    const put = (s: TranscriptState) => setTranscripts((prev) => ({ ...prev, [row.id]: s }))
    void getDiscardTranscript(row.recordingSessionId).then(
      (res) =>
        put(
          res.ok
            ? { kind: 'ready', segments: res.segments, durationSeconds: res.durationSeconds }
            : { kind: 'error' },
        ),
      // Same transport-failure rule as the list read below: a rejection is a
      // failure, not a spinner that never ends.
      () => put({ kind: 'error' }),
    )
  }

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
  }, [attempt])

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
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-6">
          <p className="text-xs text-muted-foreground">{t('loadFailed')}</p>
          {/* A failed load is recoverable, so it gets the affordance that says
              so — the quiet bordered control ThemeSection uses, never an accent
              fill: nothing on this screen should read as an alarm. */}
          <button
            type="button"
            onClick={() => {
              setState({ kind: 'loading' })
              setAttempt((n) => n + 1)
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
          >
            {tc('retry')}
          </button>
        </div>
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
                <li key={r.id}>
                  {/* The row IS the control (mock A-6's opened row). A neutral
                      tappable row, deliberately quiet — the one-way accent law
                      lets a pressable be quieter than accent, and nothing on
                      this screen should read as an alarm. */}
                  <button
                    type="button"
                    onClick={() => toggleRow(r)}
                    aria-expanded={openId === r.id}
                    className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="text-xs text-muted-foreground">
                        {fmt.format(new Date(r.createdAt))}
                      </span>
                      <span className="text-xs font-medium text-foreground">
                        {r.staffName ?? t('unknownStaff')}
                      </span>
                    </span>
                    {/* Both halves are labelled, the mock's own shape: ⚖ 8/25
                        ruling A is that the manager reads the CLAIM against the
                        EVIDENCE, and an opened row is two runs of Japanese prose
                        — leaving the upper one unnamed lets a skimming reader
                        take the staffer's words for the system's record. */}
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {t('reasonLabel')}
                    </span>
                    {/* The whole reason, never truncated: a manager reading half
                        an explanation is the failure this screen exists to fix.
                        `break-words` for the same reason — a pasted URL or code
                        run has no break opportunity, and at phone width the card
                        sits under overflow-x:hidden, so an unbroken token would
                        carry the rest of the sentence off the screen. */}
                    <span className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                      {r.reason}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t(openId === r.id ? 'transcriptHide' : 'transcriptShow')}
                    </span>
                  </button>

                  {openId === r.id && (
                    <div className="border-t border-border/60 px-4 py-3">
                      <TranscriptPanel state={transcripts[r.id]} t={t} />
                    </div>
                  )}
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

/** The opened row's other half. Plain fact in plain type — no warning colours,
 *  no badge, no threshold (⚖ 8/25 ruling B): this is evidence a manager reads,
 *  not a verdict the screen hands them. */
function TranscriptPanel({
  state,
  t,
}: {
  state: TranscriptState | undefined
  t: (key: string, values?: Record<string, number>) => string
}) {
  if (!state || state.kind === 'loading') {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t('transcriptLoading')}
      </p>
    )
  }
  if (state.kind === 'error') {
    return <p className="text-xs text-muted-foreground">{t('transcriptFailed')}</p>
  }
  if (state.segments.length === 0) {
    // Under the floor NOTHING was ever transcribed (the ⚖ spend gate), which is
    // a different fact from "the words were not kept" — say which one it is.
    const belowFloor =
      state.durationSeconds !== null && state.durationSeconds < BELOW_FLOOR_SEC
    return (
      <p className="text-xs text-muted-foreground">
        {belowFloor ? t('transcriptBelowFloor', { n: BELOW_FLOOR_SEC }) : t('transcriptNone')}
      </p>
    )
  }
  return (
    <>
      <p className="text-[11px] font-medium text-muted-foreground">{t('transcriptTitle')}</p>
      {/* Same break rule as the reason above — a spoken URL or product code
          comes back from transcription as one unbroken run. */}
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {state.segments.map((s) => s.text).join('\n\n')}
      </p>
    </>
  )
}
