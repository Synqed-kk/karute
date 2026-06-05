'use client'

import type { ReactNode } from 'react'
import type { CustomerHeaderProps } from './CustomerHeaderCard'
import { CustomerHeaderCard } from './CustomerHeaderCard'
import { DetailBreadcrumb } from './DetailBreadcrumb'
import {
  CurrentSessionCard,
  type SessionEntry,
} from './CurrentSessionCard'
import { RecordingTranscriptCard } from './RecordingTranscriptCard'
import {
  CustomerMemoryCard,
  type CustomerMemorySnapshot,
} from './CustomerMemoryCard'
import {
  AIBodyPredictionCard,
  type BodyPrediction,
} from './AIBodyPredictionCard'
import {
  AISuggestedMessageCard,
  type SuggestedMessage,
} from './AISuggestedMessageCard'
import { KaruteCoachingPanel } from '@/components/coaching/redesign/KaruteCoachingPanel'

export interface KaruteDetailViewProps {
  karuteId: string
  customerId: string | null
  header: Omit<CustomerHeaderProps, 'onEdit'>
  sessionDateLong: string
  entries: SessionEntry[]
  summaryBullets: string[]
  transcript: string | null
  consentOnFile: boolean
  transcriptDurationLabel: string | null
  // photosSlot is streamed in via Suspense from the server page so the shell can
  // paint before the photo HTTP fetch resolves.
  photosSlot: ReactNode
  memory: CustomerMemorySnapshot | null
  bodyPrediction: BodyPrediction | null
  suggestedMessage: SuggestedMessage | null
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
  photosSlot,
  memory,
  bodyPrediction,
  suggestedMessage,
}: KaruteDetailViewProps) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <DetailBreadcrumb
        karuteId={karuteId}
        customerId={customerId}
        customerName={header.customerName}
        karuteNumber={header.karuteNumber}
        sessionDateLong={sessionDateLong}
      />

      <CustomerHeaderCard {...header} />

      <CustomerMemoryCard memory={memory} />

      {photosSlot}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <AIBodyPredictionCard prediction={bodyPrediction} />
          <CurrentSessionCard
            sessionDate={sessionDateLong}
            bullets={summaryBullets}
            entries={entries}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AISuggestedMessageCard
            customerName={header.customerName}
            customerId={customerId}
            draft={suggestedMessage}
          />
          <RecordingTranscriptCard
            transcript={transcript}
            consentOnFile={consentOnFile}
            durationLabel={transcriptDurationLabel}
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
