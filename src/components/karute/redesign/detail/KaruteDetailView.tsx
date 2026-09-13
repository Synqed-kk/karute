'use client'

import { Fragment, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { CustomerHeaderProps } from './CustomerHeaderCard'
import { CustomerHeaderCard } from './CustomerHeaderCard'
import { DetailBreadcrumb } from './DetailBreadcrumb'
import { AISummaryCard } from './AISummaryCard'
import {
  CurrentSessionCard,
  type SessionEntry,
} from './CurrentSessionCard'
import { RegenerateEntriesButton } from './RegenerateEntriesButton'
import { RecordingTranscriptCard } from './RecordingTranscriptCard'
import type { KaruteDetailRecording, KaruteDetailScreenDiscarded } from '@/lib/karute/detail-screen'
import {
  CustomerMemoryCard,
  type CustomerMemorySnapshot,
} from './CustomerMemoryCard'
import { KaruteCoachingPanel } from '@/components/coaching/redesign/KaruteCoachingPanel'
import { OutcomeCard } from './OutcomeCard'
import { ReassignCustomerAction } from './ReassignCustomerAction'
import type { KaruteOutcomeRow } from '@/lib/karute/outcome'

export interface KaruteDetailViewProps {
  karuteId: string
  customerId: string | null
  header: Omit<CustomerHeaderProps, 'onEdit'>
  sessionDateLong: string
  /** Raw session date (YYYY-MM-DD) — prompt anchor for AIで再生成. */
  sessionDateIso?: string | null
  entries: SessionEntry[]
  summaryBullets: string[]
  /** Raw effective summary (edited ?? ai) — seeds the 詳細記録 pencil's edit
   *  sheet. Optional so callers that predate the pencil render read-only. */
  summaryRaw?: string | null
  /** True when the summary carries a human overlay — amber pencil. */
  summaryEdited?: boolean
  transcript: string | null
  consentOnFile: boolean
  transcriptDurationLabel: string | null
  /** A transcript exists but is withheld from this viewer (not the recording
   *  staff). The shared summary/entries still render. */
  transcriptRestricted?: boolean
  /** The audio behind this karute, AS THE VIEWER MAY HEAR IT — server-decided.
   *  null/absent = no player, and the card says nothing about one (⚖ 9/3). */
  recording?: KaruteDetailRecording | null
  // photosSlot is streamed in via Suspense from the server page so the shell can
  // paint before the photo HTTP fetch resolves. Renders directly under 詳細記録
  // and ONLY when the karute has linked photos (Liam 8/10, mock frame C) — the
  // card itself returns null on an empty list, so this slot contributes no DOM.
  photosSlot: ReactNode
  memory: CustomerMemorySnapshot | null
  /** Server-streamed via Suspense (photosSlot pattern) so the page shell never
   *  waits on an AI call — the fallback is the 対応予定 preview. */
  bodyPredictionSlot: ReactNode
  suggestedMessageSlot: ReactNode
  outcome: KaruteOutcomeRow | null
  /** F4: records.reassign gate — hides the 顧客を変更 entry point entirely
   *  for staff without the capability (hide, never show-and-refuse). */
  staffCanReassignRecords: boolean
  /** The 再生成 gate — the SERVER's answer, not "can I read the words". A
   *  named grantee sees a colleague's transcript and may not rewrite it, so
   *  the button is hidden for her rather than shown and refused
   *  (⚖ 9/3 named grant; fix round 4). Absent = hidden. */
  staffCanRegenerate?: boolean
  /** R8 discarded-record door (⚖ Liam 2026-09-13): non-null exactly when
   *  this karute is DISCARDED. Replaces OutcomeCard at the top of the
   *  column; also hides the entry pencil, both AI slots and
   *  KaruteCoachingPanel — a discarded record is read-only for everyone,
   *  regardless of who is viewing (staffCanReassignRecords/staffCanRegenerate
   *  are already server-forced false whenever this is non-null). */
  discarded?: KaruteDetailScreenDiscarded | null
  /** True when this viewer sees the facts but not the content (A4) — the ONE
   *  withheld line renders inside the facts block; every content field
   *  arriving here is already server-blanked (this component adds no
   *  additional hiding beyond the write controls). */
  contentWithheld?: boolean
}

export function KaruteDetailView({
  karuteId,
  customerId,
  header,
  sessionDateLong,
  entries,
  summaryBullets,
  summaryRaw,
  summaryEdited,
  transcript,
  consentOnFile,
  transcriptDurationLabel,
  transcriptRestricted,
  recording,
  photosSlot,
  memory,
  bodyPredictionSlot,
  suggestedMessageSlot,
  outcome,
  staffCanReassignRecords,
  staffCanRegenerate,
  discarded,
  contentWithheld,
}: KaruteDetailViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <DetailBreadcrumb
        customerId={customerId}
        customerName={header.customerName}
        karuteNumber={header.karuteNumber}
        sessionDateLong={sessionDateLong}
      />

      <CustomerHeaderCard
        {...header}
        customerHref={customerId ? `/customers/${customerId}` : undefined}
        actions={
          staffCanReassignRecords && customerId ? (
            <ReassignCustomerAction karuteId={karuteId} customerName={header.customerName} />
          ) : undefined
        }
      />

      {/* These wrapped cards (and the suggestedMessageSlot below) can
       *  legitimately render null — an empty wrapper must not hold its
       *  gap-4 slot open, so empty:hidden collapses it. Content that later
       *  fills the wrapper (e.g. Suspense resolve) flips it visible and the
       *  entrance runs then — intended. */}
      <div
        className="empty:hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[6px] motion-safe:fill-mode-backwards motion-safe:animation-duration-(--duration-base) motion-safe:ease-(--ease-out)"
        style={{ animationDelay: '0ms' }}
      >
        {discarded ? (
          <DiscardedFactsCard discarded={discarded} contentWithheld={!!contentWithheld} />
        ) : (
          <OutcomeCard
            karuteRecordId={karuteId}
            customerId={customerId}
            customerName={header.customerName}
            current={
              outcome
                ? {
                    outcome: outcome.outcome,
                    reason: outcome.reason,
                    autoDecided: outcome.auto_decided,
                    isFirstVisit: outcome.is_first_visit,
                  }
                : null
            }
          />
        )}
      </div>

      <CustomerMemoryCard memory={memory} />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {/* R8: both AI slots hidden for a discarded record — read-only for
           *  everyone, no exceptions (A5). */}
          {!discarded && bodyPredictionSlot}
          <div
            className="empty:hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[6px] motion-safe:fill-mode-backwards motion-safe:animation-duration-(--duration-base) motion-safe:ease-(--ease-out)"
            style={{ animationDelay: '40ms' }}
          >
            <CurrentSessionCard
              sessionDate={sessionDateLong}
              entries={entries}
              // R8: omit the id (never null the entries themselves — the
              // owner/viewAll holder still READS them) to disable the entry
              // pencil — a discarded record is read-only for everyone (A5).
              karuteRecordId={discarded ? undefined : karuteId}
              headerAction={
                transcript && staffCanRegenerate ? (
                  <RegenerateEntriesButton karuteRecordId={karuteId} />
                ) : null
              }
            />
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <div
            className="empty:hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[6px] motion-safe:fill-mode-backwards motion-safe:animation-duration-(--duration-base) motion-safe:ease-(--ease-out)"
            style={{ animationDelay: '80ms' }}
          >
            <AISummaryCard
              sessionDate={sessionDateLong}
              bullets={summaryBullets}
              karuteRecordId={karuteId}
              summaryRaw={summaryRaw}
              summaryEdited={summaryEdited}
            />
          </div>
          {photosSlot}
          {/* Suspense fallback mounts here and animates in; the resolved
           *  suggestedMessageSlot content swaps into this same wrapper
           *  without re-triggering the entrance (intended). R8: hidden for a
           *  discarded record (A5). */}
          <div
            className="empty:hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-[6px] motion-safe:fill-mode-backwards motion-safe:animation-duration-(--duration-base) motion-safe:ease-(--ease-out)"
            style={{ animationDelay: '120ms' }}
          >
            {!discarded && suggestedMessageSlot}
          </div>
          <RecordingTranscriptCard
            karuteId={karuteId}
            transcript={transcript}
            consentOnFile={consentOnFile}
            durationLabel={transcriptDurationLabel}
            // R8: for a discarded record, the ONE withheld line inside the
            // facts block above covers this — suppressing `restricted` here
            // avoids a SECOND, differently-worded notice (the sibling
            // restricted text claims "the summary above is shared", which is
            // false for a withheld discarded record: everything is withheld,
            // not only the transcript). transcript/recording are already
            // null here when withheld, so the card renders nothing.
            restricted={transcriptRestricted && !discarded}
            recording={recording}
          />
          {/* Layer 1 staff-private coaching panel — renders null
           *  for owners (role gate inside the component). Currently
           *  always shows the empty-state 対応予定 scaffold; lights
           *  up when Anthony passes archived per-karute suggestions
           *  via `suggestions` prop. R8: hidden for a discarded record (A5). */}
          {!discarded && <KaruteCoachingPanel suggestions={null} />}
        </div>
      </div>
    </div>
  )
}

/**
 * R8 discarded-record door (⚖ Liam 2026-09-13) — the facts block. Sits where
 * OutcomeCard sat (A5). Label · value pairs in the order F9 specifies: 破棄
 * 日時 · 破棄したスタッフ · 理由 · 担当スタッフ · 録音時間; a missing value
 * shows 不明. The ONE withheld line (F9's `discarded.withheld` string, native
 * pass A) renders below the facts ONLY when contentWithheld — it replaces the
 * WHOLE content area (summary + entries + transcript + photos + AI), not
 * only the transcript, so RecordingTranscriptCard's own differently-worded
 * restricted notice is suppressed for a discarded record (see the caller).
 */
function DiscardedFactsCard({
  discarded,
  contentWithheld,
}: {
  discarded: KaruteDetailScreenDiscarded
  contentWithheld: boolean
}) {
  const t = useTranslations('karuteDetail.discarded')
  const locale = useLocale()
  const unknown = t('unknown')

  const rows: Array<[string, string]> = [
    [t('at'), formatDiscardedAt(discarded.discardedAt, locale) ?? unknown],
    [t('by'), discarded.discardedByName ?? unknown],
    [t('reason'), discarded.reason ?? unknown],
    [t('staff'), discarded.recordStaffName ?? unknown],
    [
      t('duration'),
      discarded.durationSeconds != null
        // Same "{m}分{s}秒" / "{m}m {s}s" shape as 破棄の記録's own
        // durationValue idiom (settings.discardReasons) — a SEPARATE key in
        // THIS (already-hot) namespace rather than pulling in a cold
        // namespace for one string (i18n-client-messages-closure.test.ts).
        ? t('durationValue', durationParts(discarded.durationSeconds))
        : unknown,
    ],
  ]

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <span className="inline-flex w-fit items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
        {t('title')}
      </span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-foreground/90">{value}</dd>
          </Fragment>
        ))}
      </dl>
      {contentWithheld && (
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          {t('withheld')}
        </p>
      )}
    </section>
  )
}

/** Whole minutes + zero-padded seconds — same shape as
 *  DiscardReasonsSection.tsx's own `durationParts` (not imported: that
 *  function is file-local/unexported there). */
function durationParts(sec: number): { m: string; s: string } {
  const whole = Math.max(0, Math.floor(sec))
  return { m: String(Math.floor(whole / 60)), s: String(whole % 60).padStart(2, '0') }
}

/** JST-explicit (this codebase's standing rule for every business-fact
 *  timestamp — see KaruteRecordListView's formatDateHeader/formatBoundaryDate
 *  for the sibling idiom): the discard event's instant is a JST business
 *  fact, not a local wall-clock time. */
function formatDiscardedAt(iso: string | null, locale: string): string | null {
  if (!iso) return null
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return null
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: locale === 'ja' ? 'long' : 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt)
}
