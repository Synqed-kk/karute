import { getCustomerKaruteRecords } from '@/actions/karute'
import { getBodyPrediction } from '@/lib/karute/ai-body-prediction'
import { getSuggestedFollowUp } from '@/lib/karute/ai-outreach'
import {
  AIBodyPredictionPreview,
  AIOutreachPreview,
} from '@/components/customers/redesign/profile/UpcomingAiFeatures'
import { AIBodyPredictionCard } from './AIBodyPredictionCard'
import { AISuggestedMessageCard } from './AISuggestedMessageCard'

/**
 * Server components streamed into the karute detail via Suspense (photosSlot
 * pattern) — the page shell paints instantly; each card fills in when its
 * (cached) AI result resolves. On null (too little history, generation
 * failure, missing summary) the 対応予定 preview stays, exactly as before
 * activation — the page can never look worse than it did.
 */

export async function AIBodyPredictionSlot({
  customerId,
  locale,
}: {
  customerId: string
  locale: string
}) {
  // 8 sessions ≈ 2 months of rhythm — enough trajectory without paying for a
  // long tail the model would summarize away anyway.
  const records = await getCustomerKaruteRecords(customerId, 8)
  const prediction = await getBodyPrediction({ customerId, records, locale })
  if (!prediction) return <AIBodyPredictionPreview />
  return <AIBodyPredictionCard prediction={prediction} />
}

export async function AISuggestedMessageSlot({
  karuteId,
  customerId,
  customerName,
  summary,
  locale,
  appointmentId,
  storeId,
}: {
  karuteId: string
  customerId: string | null
  customerName: string
  summary: string | null
  locale: string
  /** This karute's own linked appointment/store (D7) — threaded through to
   *  the next-booking line so it excludes its own visit and prefers the
   *  session's store. */
  appointmentId?: string | null
  storeId?: string | null
}) {
  const draft = await getSuggestedFollowUp({
    karuteId,
    customerId,
    customerName,
    summary,
    locale,
    appointmentId: appointmentId ?? null,
    storeId: storeId ?? null,
  })
  if (!draft) return <AIOutreachPreview />
  return (
    <AISuggestedMessageCard
      customerName={customerName}
      customerId={customerId}
      draft={draft}
    />
  )
}
