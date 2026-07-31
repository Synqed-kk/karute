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
}: {
  karuteId: string
  customerId: string | null
  customerName: string
  summary: string | null
  locale: string
}) {
  const draft = await getSuggestedFollowUp({ karuteId, customerId, customerName, summary, locale })
  if (!draft) return <AIOutreachPreview />
  return (
    <AISuggestedMessageCard
      customerName={customerName}
      customerId={customerId}
      draft={draft}
    />
  )
}
