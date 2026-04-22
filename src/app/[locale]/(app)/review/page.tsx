import { getCachedCustomerList } from '@/lib/customers/cached'
import { SaveKaruteFlow } from '@/components/karute/SaveKaruteFlow'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'

// TODO: Replace with full Phase 2 review UI when AI pipeline is built.
// This placeholder page renders the save step of the review flow.
// The Phase 2 recording page will collect transcript, summary, and confirmed
// entries in memory, call saveDraft() to write them to sessionStorage, then
// render ReviewConfirmStep (which reads the draft and renders SaveKaruteFlow).
//
// For now, the page reads the existing sessionStorage draft directly via
// SaveKaruteFlow so the save flow can be tested independently of Phase 2.

/**
 * Review page — the final step of the AI review flow.
 *
 * Server component: pre-fetches the customer list so SaveKaruteFlow
 * doesn't need a client-side fetch on mount.
 *
 * The draft data (transcript, summary, entries) is read from sessionStorage
 * by SaveKaruteFlow on the client. It must have been written by a prior step
 * (Phase 2 recording flow, or a test that calls saveDraft() directly).
 */
export default async function ReviewPage() {
  const cachedList = await getCachedCustomerList()

  const customers: CustomerOption[] = cachedList.map((c) => ({
    id: c.id,
    name: c.name,
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Review Complete</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        Your entries have been confirmed. Select a customer and save to create the karute record.
      </p>

      {/* SaveKaruteFlow reads the draft from sessionStorage on mount */}
      <SaveKaruteFlow customers={customers} />
    </div>
  )
}
