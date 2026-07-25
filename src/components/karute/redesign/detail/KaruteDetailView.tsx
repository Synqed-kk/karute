'use client'

import type { ReactNode } from 'react'
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
import {
  CustomerMemoryCard,
  type CustomerMemorySnapshot,
} from './CustomerMemoryCard'
import { KaruteCoachingPanel } from '@/components/coaching/redesign/KaruteCoachingPanel'
import { OutcomeCard } from './OutcomeCard'
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
  transcript: string | null
  consentOnFile: boolean
  transcriptDurationLabel: string | null
  /** A transcript exists but is withheld from this viewer (not the recording
   *  staff). The shared summary/entries still render. */
  transcriptRestricted?: boolean
  // photosSlot is streamed in via Suspense from the server page so the shell can
  // paint before the photo HTTP fetch resolves.
  photosSlot: ReactNode
  memory: CustomerMemorySnapshot | null
  /** Server-streamed via Suspense (photosSlot pattern) so the page shell never
   *  waits on an AI call — the fallback is the 対応予定 preview. */
  bodyPredictionSlot: ReactNode
  suggestedMessageSlot: ReactNode
  outcome: KaruteOutcomeRow | null
}

export function KaruteDetailView({
  karuteId,
  customerId,
  header,
  sessionDateLong,
  entries,
  summaryBullets,
  transcript,
  consentOnFile,
  transcriptDurationLabel,
  transcriptRestricted,
  photosSlot,
  memory,
  bodyPredictionSlot,
  suggestedMessageSlot,
  outcome,
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
      />

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

      <CustomerMemoryCard memory={memory} />

      {photosSlot}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          {bodyPredictionSlot}
          <CurrentSessionCard
            sessionDate={sessionDateLong}
            entries={entries}
            karuteRecordId={karuteId}
            customerId={customerId}
            headerAction={
              transcript ? (
                <RegenerateEntriesButton karuteRecordId={karuteId} />
              ) : null
            }
          />
        </div>
        <div className="flex flex-col gap-4">
          {suggestedMessageSlot}
          <AISummaryCard sessionDate={sessionDateLong} bullets={summaryBullets} />
          <RecordingTranscriptCard
            transcript={transcript}
            consentOnFile={consentOnFile}
            durationLabel={transcriptDurationLabel}
            restricted={transcriptRestricted}
          />
          {/* Layer 1 staff-private coaching panel — renders null
           *  for owners (role gate inside the component). Currently
           *  always shows the empty-state 対応予定 scaffold; lights
           *  up when Anthony passes archived per-karute suggestions
           *  via `suggestions` prop. */}
          <KaruteCoachingPanel suggestions={null} />
        </div>
      </div>
    </div>
  )
}
