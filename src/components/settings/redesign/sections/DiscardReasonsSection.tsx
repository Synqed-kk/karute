'use client'

// 破棄の記録 — the manager read of why recordings were thrown away (packet
// P5-A item A-6; rebuilt 2026-08-31 to the approved mock
// MOCK-DISCARD-REDESIGN-2026-08-31).
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
// they are read side by side — in the same row on a phone, in two equal cards
// on a computer.
//
// TWO COMPOSITIONS, ONE TREE (⚖ 8/30, desktop surpasses phone). Below `lg` the
// row IS the record: everything about a discard is in it, opened in place.
// At `lg` and up the same rows become a master list beside a detail pane, which
// is the shape a desk actually reads — the whole reason next to the whole
// transcript, no scroll hunt between them. Only ONE composition is ever in the
// DOM: the width is decided in JS (`useIsWide`) rather than by hiding a second
// copy, because a duplicated row list would double the open row's transcript.
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
// The same rule governs the row's own facts. Customer, recording time, length
// and store are joined server-side from the recording behind the discard, and
// every one of those joins is best-effort — so an absent value renders as
// nothing at all (no name line, no length pill, no store), never as a guess and
// never as a zero. On the computer's definition row, where a four-column grid
// would break, it reads 「不明」: still a statement about our knowledge, not
// about the recording.
//
// LONG RECORDINGS (⚖ Liam 8/31, both doors): the transcript is bounded — it
// scrolls inside its own panel with a sticky header and a marker every five
// minutes. A forty-minute session must not grow the row, and it must not turn
// the page into a scroll the reader has to escape.
//
// NOT IN THIS ROUND: the ✓確認済み mark. The SDK's discard row has no update
// surface — create/list only, verified 1.28.0 — so the mark has no durable
// home. It stays in the mock as a spec line for core rather than shipping here
// as a control that would forget what it was told.

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
  | {
      kind: 'ready'
      segments: { text: string; startTime: number | null }[]
      durationSeconds: number | null
    }

/** next-intl's `t` as this file uses it — string values as well as numbers,
 *  because most of these keys interpolate a formatted date or a name. */
type T = (key: string, values?: Record<string, string | number>) => string

/** Seconds between transcript markers. Five minutes is the mock's own step:
 *  fine enough to find a moment in a forty-minute session, coarse enough that a
 *  two-minute one gets none at all. */
const MARKER_STEP_SEC = 300

/** The `lg` breakpoint, in the one place both the CSS and the JS must agree on
 *  it (Tailwind's default lg = 1024px). */
const WIDE_QUERY = '(min-width: 1024px)'

/** Which composition to render. Starts NARROW and only widens once the browser
 *  has answered, so a runtime without matchMedia (the server pass, and jsdom)
 *  renders the phone shape rather than throwing — the inline row is the
 *  composition that works at every width, so it is the safe default.
 *  Same local-hook idiom as BookingActionSheetWrapper's own useIsMobile. */
function useIsWide() {
  const [isWide, setIsWide] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(WIDE_QUERY)
    const handler = () => setIsWide(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isWide
}

/** Whole minutes + zero-padded seconds, the mock's 「4分12秒」 shape. Negative
 *  and fractional durations are floored to a real clock reading rather than
 *  rendered raw — core stores seconds, but a number we print is a claim. */
function durationParts(sec: number): { m: string; s: string } {
  const whole = Math.max(0, Math.floor(sec))
  return { m: String(Math.floor(whole / 60)), s: String(whole % 60).padStart(2, '0') }
}

/** m:ss, the transcript's own left column. */
function clockOf(sec: number): string {
  const whole = Math.max(0, Math.floor(sec))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Same CALENDAR day, in the viewer's own zone — which is the zone the
 *  formatters below print in, so 「同日」 can never disagree with the date it
 *  sits beside. */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** The avatar's letter. The first character of the name a manager already reads
 *  on the row — never initials parsed out of a Japanese name, which has no
 *  reliable given/family split. `？` when there is no customer at all. */
function initialOf(name: string | null): string {
  return name?.trim()?.[0] ?? '？'
}

export function DiscardReasonsSection() {
  const t = useTranslations('settings.discardReasons') as T
  const tc = useTranslations('common')
  const locale = useLocale()
  const isWide = useIsWide()
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
  /** One row at a time. On a phone it is the row that is OPEN; on a computer it
   *  is the row that is SELECTED — the same state, because on both doors it
   *  answers the same question: which discard is being read. */
  const [openId, setOpenId] = useState<string | null>(null)
  /** Kept per row once fetched: re-opening a row must not re-read core. */
  const [transcripts, setTranscripts] = useState<Record<string, TranscriptState>>({})

  /** `toggle` is what separates the two doors. Inline, pressing the open row
   *  closes it — the transcript is a drawer. In the master–detail pane there is
   *  nowhere for a closed selection to go, so a press only ever moves the
   *  selection; a pane that could be emptied by pressing its own row would just
   *  be a way to make the screen show less. */
  function openRow(row: DiscardReasonRow, toggle: boolean) {
    const next = toggle && openId === row.id ? null : row.id
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

  const rows = state.kind === 'ready' ? state.rows : []
  const selected = rows.find((r) => r.id === openId) ?? null

  // The detail pane needs a selection to have anything to show, so arriving on
  // the wide composition opens the newest row — the same lazy read a press
  // would do, once. Deliberately NOT done for the inline composition: there
  // every row is already complete without opening one, and auto-opening would
  // fetch a transcript nobody asked to read.
  useEffect(() => {
    // Keyed on the RESOLVED selection rather than on `openId`. The two are
    // equivalent today — the only reload path runs through the error card,
    // which is unreachable once a list has rendered — but they stop being
    // equivalent the moment this list can refresh in place: a held id naming a
    // row the new list no longer holds would leave the pane blank with nothing
    // to press to fill it. Asking the question the pane actually cares about
    // costs nothing and does not have to be revisited then.
    if (!isWide || selected !== null || rows.length === 0) return
    openRow(rows[0], false)
    // openRow closes over state this effect must not re-run on; the guard above
    // is the real condition (it fires once, when a selection is missing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWide, selected, rows])

  const dateTimeFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ja-JP', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const timeFmt = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })

  /** 「破棄 同日 14:33」 when the take was thrown away the day it was made —
   *  which is nearly every real discard — and the full date when it was not,
   *  because "同日" against a different day would be a lie. */
  const discardedWhen = (row: DiscardReasonRow) => {
    const at = new Date(row.createdAt)
    const rec = row.recordingCreatedAt ? new Date(row.recordingCreatedAt) : null
    return rec && isSameLocalDay(rec, at)
      ? `${t('sameDay')} ${timeFmt.format(at)}`
      : dateTimeFmt.format(at)
  }

  return (
    <div className="space-y-4">
      <div className="lg:flex lg:items-start lg:justify-between lg:gap-8">
        <div className="min-w-0">
          {/* The drill-in shell already titles this section above `md` — a
              second 破棄の記録 under its own heading was the triple stack Liam
              read in the field. Above `md` the shell shows only a tab chip, so
              here the heading is the page's own and has to be rendered. */}
          <h2 className="hidden text-base font-semibold text-foreground md:block">{t('title')}</h2>
          <p className="text-xs leading-relaxed text-muted-foreground md:mt-2">
            {t('description')}
          </p>
        </div>

        {state.kind === 'ready' && (
          <SummaryBand counts={state.counts} truncated={state.truncated} t={t} />
        )}
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

      {state.kind === 'ready' &&
        (rows.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-4 py-6 text-xs text-muted-foreground">
            {t('empty')}
          </p>
        ) : isWide ? (
          // The master column gives ground back to the detail pane on a narrow
          // desktop: at the mock's own 1280 it is the mock's 360px, and between
          // 1024 and there it yields 60px so the pane's two cards keep their
          // width rather than the list keeping its own.
          <div className="grid grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-xl border border-border bg-card xl:grid-cols-[360px_minmax(0,1fr)]">
            <ul className="max-h-[660px] divide-y divide-border/60 overflow-y-auto border-r border-border">
              {rows.map((r) => (
                <li key={r.id}>
                  <CompactRow
                    row={r}
                    selected={r.id === openId}
                    onSelect={() => openRow(r, false)}
                    recordedWhen={
                      r.recordingCreatedAt
                        ? dateTimeFmt.format(new Date(r.recordingCreatedAt))
                        : null
                    }
                    discardedWhen={discardedWhen(r)}
                    t={t}
                  />
                </li>
              ))}
            </ul>
            {selected && (
              <DetailPane
                row={selected}
                transcript={transcripts[selected.id]}
                recordedWhen={
                  selected.recordingCreatedAt
                    ? dateTimeFmt.format(new Date(selected.recordingCreatedAt))
                    : null
                }
                discardedWhen={discardedWhen(selected)}
                t={t}
              />
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-card">
            {rows.map((r) => (
              <li key={r.id} className={r.id === openId ? 'bg-muted/25' : undefined}>
                <InlineRow
                  row={r}
                  open={r.id === openId}
                  onToggle={() => openRow(r, true)}
                  transcript={transcripts[r.id]}
                  recordedWhen={
                    r.recordingCreatedAt
                      ? dateTimeFmt.format(new Date(r.recordingCreatedAt))
                      : null
                  }
                  discardedWhen={discardedWhen(r)}
                  t={t}
                />
              </li>
            ))}
          </ul>
        ))}

      {state.kind === 'ready' && state.truncated && (
        <p className="px-1 text-[11px] text-muted-foreground">{t('truncated')}</p>
      )}
    </div>
  )
}

/** Labelled plain facts, quieter than the list they describe — a wash, no
 *  border, no tile. Each number says WHAT it counts, and past the read cap that
 *  includes saying the older records are not in it (⚖ 8/25 ruling B). */
function SummaryBand({
  counts,
  truncated,
  t,
}: {
  counts: DiscardReasonCounts
  truncated: boolean
  t: T
}) {
  return (
    <div className="mt-3 shrink-0 rounded-xl bg-muted/40 px-3.5 py-3 lg:mt-0 lg:bg-transparent lg:px-0 lg:py-0 lg:text-right">
      <p className="text-xs leading-relaxed text-muted-foreground">
        <span className="whitespace-nowrap">{t('countThisMonth', { count: counts.thisMonth })}</span>
        <span className="mx-1.5 text-muted-foreground/60">・</span>
        <span className="whitespace-nowrap">{t('countTotal', { count: counts.total })}</span>
      </p>
      {counts.byStaff.length > 0 && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground/80">
          <span className="mr-1.5 whitespace-nowrap">{t('byStaffTitle')}</span>
          {counts.byStaff.map((s, i) => (
            <span key={s.staffId}>
              {i > 0 && <span className="mx-1.5 text-muted-foreground/50">・</span>}
              <span className="whitespace-nowrap">
                {t('byStaffItem', {
                  name: s.staffName ?? t('unknownStaff'),
                  count: s.thisMonth,
                })}
              </span>
            </span>
          ))}
        </p>
      )}
      {truncated && (
        <p className="mt-1.5 text-[11px] text-muted-foreground/80">{t('countsTruncated')}</p>
      )}
    </div>
  )
}

/** The customer's first character on a soft chip. Decoration, so it stays in
 *  the sanctioned wash tier (bg-blue-100/text-blue-700 + its dark twin) rather
 *  than the saturated accent the one-way law reserves for pressables — and goes
 *  fully neutral when there is no customer to stand for. */
function Avatar({ name, large }: { name: string | null; large?: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-bold ${
        large ? 'size-9 text-sm' : 'size-7 text-xs'
      } ${
        name
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
          : 'bg-muted text-muted-foreground/70'
      }`}
    >
      {initialOf(name)}
    </span>
  )
}

/** 「録音 4分12秒」. Absent when the length could not be read — a pill saying
 *  0分00秒 would be a claim about the recording rather than about us. */
function DurationPill({ seconds, t }: { seconds: number | null; t: T }) {
  // `typeof`, not `=== null`. The row fields are not re-typed at the thin port
  // (the wire is trusted for display-only strings), so a server older than this
  // build answers with the key ABSENT — and `undefined === null` is false,
  // which would have put 「録音 NaN分NaN秒」 on a manager's screen. Anything
  // that is not a number is a length we do not have.
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
      {t('durationLabel', durationParts(seconds))}
    </span>
  )
}

/** The name a row leads with, or the honest 顧客未選択 when no customer was
 *  ever attached to the take. */
function CustomerName({ name, className, t }: { name: string | null; className: string; t: T }) {
  return (
    <span className={`${className} ${name ? 'font-semibold' : 'font-medium text-muted-foreground'}`}>
      {name ?? t('customerNone')}
    </span>
  )
}

/** The phone composition: the row IS the record, and the row IS the control.
 *  A neutral tappable row, deliberately quiet — the one-way accent law lets a
 *  pressable be quieter than accent, and nothing on this screen should read as
 *  an alarm. */
function InlineRow({
  row,
  open,
  onToggle,
  transcript,
  recordedWhen,
  discardedWhen,
  t,
}: {
  row: DiscardReasonRow
  open: boolean
  onToggle: () => void
  transcript: TranscriptState | undefined
  recordedWhen: string | null
  discardedWhen: string
  t: T
}) {
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-4 py-3.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex items-center justify-between gap-2.5">
          <span className="flex min-w-0 items-center gap-2.5">
            <Avatar name={row.customerName} />
            <CustomerName name={row.customerName} className="truncate text-sm" t={t} />
          </span>
          <DurationPill seconds={row.durationSeconds} t={t} />
        </span>

        {/* The recording's OWN time and place. Absent together with the
            recording they describe — an unreadable join drops the line rather
            than printing a date we do not have. */}
        {recordedWhen && (
          <span className="mt-1.5 block text-xs text-muted-foreground">
            {t('recordedAt', { when: recordedWhen })}
            {row.storeName && (
              <>
                <span className="mx-1.5 text-muted-foreground/60">・</span>
                {row.storeName}
              </>
            )}
          </span>
        )}

        <span className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {t('discardedAt', { when: discardedWhen })}
          <span className="text-muted-foreground/60">・</span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {row.staffName ?? t('unknownStaff')}
          </span>
        </span>

        {/* Both halves are labelled, the mock's own shape: ⚖ 8/25 ruling A is
            that the manager reads the CLAIM against the EVIDENCE, and an opened
            row is two runs of Japanese prose — leaving the upper one unnamed
            lets a skimming reader take the staffer's words for the system's
            record. */}
        <span className="mt-3 block text-[11px] font-semibold text-muted-foreground">
          {t('reasonLabel')}
        </span>
        {/* The whole reason, never truncated: a manager reading half an
            explanation is the failure this screen exists to fix. `break-words`
            for the same reason — a pasted URL or code run has no break
            opportunity, and at phone width the card sits under
            overflow-x:hidden, so an unbroken token would carry the rest of the
            sentence off the screen. */}
        <span className="mt-1 block whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {row.reason}
        </span>

        <span className="mt-3 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <span>{t(open ? 'transcriptHide' : 'transcriptShow')}</span>
          <span aria-hidden className="text-[9px]">
            {open ? '▴' : '▾'}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-border/60 px-4 pb-4 pt-3">
          <TranscriptPanel state={transcript} t={t} />
        </div>
      )}
    </>
  )
}

/** The computer's master column. The reason is EXCERPTED to one line here —
 *  legal only because the whole of it is always open in the pane beside this
 *  list, which is the same ⚖ 8/25 ruling A pairing the phone row makes
 *  vertically. */
function CompactRow({
  row,
  selected,
  onSelect,
  recordedWhen,
  discardedWhen,
  t,
}: {
  row: DiscardReasonRow
  selected: boolean
  onSelect: () => void
  recordedWhen: string | null
  discardedWhen: string
  t: T
}) {
  const staff = row.staffName ?? t('unknownStaff')
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected}
      className={`w-full border-l-2 px-4 py-3.5 text-left transition-colors ${
        selected ? 'border-primary bg-primary/8' : 'border-transparent hover:bg-muted/40'
      }`}
    >
      <span className="flex items-center justify-between gap-2.5">
        <CustomerName
          name={row.customerName}
          className={`truncate text-[13px] ${selected && row.customerName ? 'text-primary' : ''}`}
          t={t}
        />
        <DurationPill seconds={row.durationSeconds} t={t} />
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {/* Normally the recording's own time, then who threw it away. When the
            recording could not be read there is no 録音 fact to state, so the
            line collapses to the DISCARD's time and hand — one 破棄, never the
            word twice, and never a date under a label that would misname it. */}
        {recordedWhen ? (
          <>
            {t('recordedAt', { when: recordedWhen })}
            <span className="mx-1.5 text-muted-foreground/60">・</span>
            {t('discardedBy', { staff })}
          </>
        ) : (
          t('discardedAt', { when: t('discardedByAt', { when: discardedWhen, staff }) })
        )}
      </span>
      <span className="mt-1 block truncate text-xs text-foreground/80">{row.reason}</span>
    </button>
  )
}

/** The computer's detail pane: who, then the four facts about the take, then
 *  the claim and the evidence as TWO EQUAL CARDS (⚖ 8/25 ruling A — neither
 *  one is the subordinate of the other). */
function DetailPane({
  row,
  transcript,
  recordedWhen,
  discardedWhen,
  t,
}: {
  row: DiscardReasonRow
  transcript: TranscriptState | undefined
  recordedWhen: string | null
  discardedWhen: string
  t: T
}) {
  const defs: { k: string; v: string }[] = [
    { k: t('defRecordedAt'), v: recordedWhen ?? t('unknownValue') },
    {
      k: t('defDuration'),
      // Same `typeof` guard as the pill, for the same old-wire reason.
      v:
        typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds)
          ? t('durationLabel', durationParts(row.durationSeconds))
          : t('unknownValue'),
    },
    { k: t('defStore'), v: row.storeName ?? t('unknownValue') },
    {
      k: t('defDiscarded'),
      v: t('discardedByAt', {
        when: discardedWhen,
        staff: row.staffName ?? t('unknownStaff'),
      }),
    },
  ]

  return (
    <div className="min-w-0 px-6 py-5">
      <div className="flex items-center gap-2.5">
        <Avatar name={row.customerName} large />
        <CustomerName name={row.customerName} className="truncate text-base" t={t} />
      </div>

      {/* Four columns is the mock's shape and it needs the mock's width. Below
          1280 the same four facts sit two-up rather than squeezing a
          「8月31日(月) 14:28」 into a column too narrow to hold it. */}
      <dl className="mt-4 grid grid-cols-2 gap-5 border-y border-border/60 py-3.5 xl:grid-cols-4">
        {defs.map((d) => (
          <div key={d.k} className="min-w-0">
            <dt className="text-[11px] font-medium text-muted-foreground">{d.k}</dt>
            <dd className="mt-1 break-words text-[13px] font-semibold text-foreground">{d.v}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 grid grid-cols-2 items-start gap-4">
        <div className="rounded-xl border border-border/60 p-4">
          <p className="text-[11px] font-semibold text-muted-foreground">{t('reasonLabel')}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {row.reason}
          </p>
        </div>
        <TranscriptPanel state={transcript} t={t} wide />
      </div>
    </div>
  )
}

/** The opened row's other half. Plain fact in plain type — no warning colours,
 *  no badge, no threshold (⚖ 8/25 ruling B): this is evidence a manager reads,
 *  not a verdict the screen hands them.
 *
 *  The words SCROLL INSIDE THIS PANEL (⚖ Liam 8/31). Everything that is not the
 *  words themselves — the three absences and the failed read — renders
 *  unbounded, because each is a single line and a one-line answer inside a
 *  420px frame would look like something was withheld. */
function TranscriptPanel({
  state,
  t,
  wide,
}: {
  state: TranscriptState | undefined
  t: T
  wide?: boolean
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
      <>
        <p className="text-[11px] font-semibold text-muted-foreground">{t('transcriptTitle')}</p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {belowFloor ? t('transcriptBelowFloor', { n: BELOW_FLOOR_SEC }) : t('transcriptNone')}
        </p>
      </>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card">
      {/* The scroll container is this div, so the header below stickies to the
          PANEL and not to the page — a header that stuck to the page would
          leave the panel while its words scrolled past it. `overscroll-contain`
          keeps a flick at the end of the transcript from scrolling the settings
          page behind it, which on a phone reads as the screen jumping. The
          scrollbar is drawn thin but ALWAYS visible: macOS hides overlay bars,
          and a bounded panel that gives no sign of being scrollable reads as a
          truncated transcript. */}
      <div
        className={`overflow-y-auto overscroll-contain [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[3px] [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-card [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:bg-clip-padding [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-[11px] ${
          wide ? 'max-h-[460px]' : 'max-h-[420px]'
        }`}
      >
        <div className="sticky top-0 z-[2] flex h-9 items-center justify-between gap-3 border-b border-border/60 bg-card px-3.5">
          <span className="text-[11px] font-semibold text-muted-foreground">
            {t('transcriptTitle')}
          </span>
          {typeof state.durationSeconds === 'number' && (
            <span className="whitespace-nowrap text-[11px] font-semibold tabular-nums text-muted-foreground">
              {t('durationLabel', durationParts(state.durationSeconds))}
            </span>
          )}
        </div>

        <div className="space-y-2 px-3.5 pb-6 pt-3">
          {state.segments.map((s, i) => {
            const prev = i > 0 ? state.segments[i - 1] : null
            // A marker only where the words CROSS a five-minute boundary, and
            // only when both sides carry a time. An older deployment sends no
            // times at all, and then the transcript is simply unmarked — never
            // marked at guessed places.
            const marker =
              prev !== null &&
              typeof s.startTime === 'number' &&
              typeof prev.startTime === 'number' &&
              Math.floor(s.startTime / MARKER_STEP_SEC) >
                Math.floor(prev.startTime / MARKER_STEP_SEC)
                ? Math.floor(s.startTime / MARKER_STEP_SEC) * (MARKER_STEP_SEC / 60)
                : null
            return (
              <div key={i}>
                {marker !== null && (
                  <div className="flex items-center gap-2.5 pb-2 pt-1">
                    <span className="h-px flex-1 bg-border/60" />
                    <span className="text-[10px] font-semibold tabular-nums text-muted-foreground/70">
                      {t('transcriptMinutes', { n: marker })}
                    </span>
                    <span className="h-px flex-1 bg-border/60" />
                  </div>
                )}
                {/* Same break rule as the reason — a spoken URL or product code
                    comes back from transcription as one unbroken run. */}
                <p className="break-words text-[13px] leading-relaxed text-foreground/90">
                  {typeof s.startTime === 'number' && (
                    <span className="mr-2 inline-block min-w-8 text-[11px] font-semibold tabular-nums text-muted-foreground/70">
                      {clockOf(s.startTime)}
                    </span>
                  )}
                  {s.text}
                </p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Fades, not borders: they say "there is more" at both ends without
          drawing a line the reader could mistake for the end of the words. Held
          off the scrollbar's own track on the right. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-px top-9 h-5 bg-gradient-to-b from-card to-transparent"
      />
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-px right-[11px] h-11 bg-gradient-to-t from-card to-transparent"
      />
    </div>
  )
}
