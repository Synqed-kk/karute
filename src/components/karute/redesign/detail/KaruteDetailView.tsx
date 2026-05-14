'use client'

import type { PhotoRecord } from './PhotoRecordsCard'
import { PhotoRecordsCard } from './PhotoRecordsCard'
import type { CustomerHeaderProps } from './CustomerHeaderCard'
import { CustomerHeaderCard } from './CustomerHeaderCard'
import { DetailBreadcrumb } from './DetailBreadcrumb'
import { AISummaryCard } from './AISummaryCard'
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
  photos: PhotoRecord[]
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
  photos,
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

      <PhotoRecordsCard photos={photos} />

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <AIBodyPredictionCard prediction={bodyPrediction} />
          <CurrentSessionCard
            sessionDate={sessionDateLong}
            entries={entries}
          />
        </div>
        <div className="flex flex-col gap-4">
          <AISuggestedMessageCard
            customerName={header.customerName}
            draft={suggestedMessage}
          />
          <AISummaryCard sessionDate={sessionDateLong} bullets={summaryBullets} />
          <RecordingTranscriptCard
            transcript={transcript}
            consentOnFile={consentOnFile}
            durationLabel={transcriptDurationLabel}
          />
        </div>
      </div>
    </div>
  )
}
