import { getReengagementDraft, type ReengagementParams } from '@/lib/karute/ai-reengagement'
import { CustomerReengagementCard } from './CustomerReengagementCard'
import { CustomerReengagementPreview } from './UpcomingAiFeatures'

/**
 * Async server component streamed into the customer profile via Suspense —
 * the AIBodyPredictionSlot pattern (src/components/karute/redesign/detail/
 * AiInsightSlots.tsx). Customer facts are threaded from the server page's
 * already-fetched profile screen (no second customer fetch); the generator
 * itself owns the full gate order (plan → status/day → tier) and returns
 * null for every excluded case, so this component only ever branches on
 * "did a draft come back" — exactly like AIBodyPredictionSlot.
 */
export async function CustomerReengagementSlot(params: ReengagementParams) {
  const draft = await getReengagementDraft(params)
  if (!draft) return <CustomerReengagementPreview />
  return (
    <CustomerReengagementCard
      customerId={params.customerId}
      customerName={params.customerName}
      lastVisitAgoDays={params.lastVisitAgoDays}
      draft={draft}
    />
  )
}
