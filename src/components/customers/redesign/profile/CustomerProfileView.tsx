'use client'

// STRUCTURE: end-to-end mirror of spike's customer profile page
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/app/[locale]/(app)/customers/[id]/page.tsx
//
// Top-to-bottom matches spike line-for-line:
//   1. Back-to-list breadcrumb (desktop only — `hidden md:flex`)
//   2. CustomerIdentityCard         (spike: CustomerProfileIdentity)
//   3. CustomerReengagementPreview  (spike: CustomerReengagementCard —
//                                     the ONE AI surface above tabs.
//                                     Placeholder for now.)
//   4. CustomerTabBar               (Memory / Sessions / Photos / Privacy,
//                                     spike's underline+blue-icon style)
//   5. Tab content:
//        memory  → MemoryTabContent
//        sessions → SessionsTabContent
//        photos  → PhotoRecordCard (LIFTED FROM SPIKE — lives in
//                  the Photos tab, NOT above tabs. Earlier commits
//                  wrongly placed it above; this matches spike.)
//        privacy → PrivacyTabContent
//
// NOT on this page:
//   - AIBodyPredictionPreview / AIOutreachPreview / AISummaryPreview /
//     RecordingTranscriptPreview — those live on the spike's
//     KARUTE DETAIL page (`/karute`), not the customer profile.
//     Still defined in UpcomingAiFeatures.tsx for the future karute-
//     detail page lift.
//
// NOT YET ported (spike has, karute doesn't):
//   - CustomerDeletionBanner — pending-deletion warning. Karute
//     doesn't have scheduled-deletion plumbing yet; add when that
//     ships.
//   - EditCustomerDialog — handled via the existing CustomerSheet on
//     other routes; inline edit on profile is a separate task.

import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { CustomerProfileData } from '../types'
import { CustomerIdentityCard } from './CustomerIdentityCard'
import { RegenerateAllForCustomerButton } from './RegenerateAllForCustomerButton'
import { CustomerTabBar, type CustomerProfileTab } from './CustomerTabBar'
import { CustomerMemoryCard } from '@/components/karute/spike-lifted/memory/CustomerMemoryCard'
import type { CustomerMemory } from '@/components/karute/spike-lifted/memory/types'
import { BookingMemoCard } from './BookingMemoCard'
import {
  SessionsTabContent,
  type CustomerSessionEntry,
} from './SessionsTabContent'
import { PhotosTabContent, type CustomerPhoto } from './PhotosTabContent'
import { PrivacyTabContent } from './PrivacyTabContent'
import { CustomerReengagementPreview } from './UpcomingAiFeatures'
import { CustomerDeletionBanner } from '../CustomerDeletionBanner'
import { TicketPackCard } from './TicketPackCard'
import type { CustomerLifecycle, PackWithUsage } from '@/lib/packs/types'

interface CustomerProfileViewProps {
  customer: CustomerProfileData
  sessions: CustomerSessionEntry[]
  /** Server-loaded customer photos via listCustomerPhotos action.
   *  Threaded into PhotosTabContent (read-only thumbnail grid).
   *  Earlier this prop was discarded (`_photos`) and the Photos tab
   *  mounted PhotoRecordCard, which uses an in-memory usePhotoStore
   *  with no Supabase Storage wiring — real DB photos never rendered,
   *  and uploads vanished on reload. PhotosTabContent already exists
   *  with the right shape (signedUrl/category/caption) for read-only
   *  display, so the fix is mounting it here. */
  photos: CustomerPhoto[]
  /** Persistent customer memory (5 categories), read from the store +
   *  one-time backfill on the server. Omitted → card shows its empty state. */
  customerMemory?: CustomerMemory
  /** 回数券 + lifecycle (卒業/離客/口コミ) — server-loaded via the packs store.
   *  Empty until the ticket_packs migration is applied (graceful). */
  packs?: PackWithUsage[]
  lifecycle?: CustomerLifecycle | null
}

export function CustomerProfileView({
  customer,
  sessions,
  photos,
  customerMemory,
  packs = [],
  lifecycle = null,
}: CustomerProfileViewProps) {
  const [tab, setTab] = useState<CustomerProfileTab>('memory')

  return (
    <main className="mx-auto w-full max-w-[1120px] space-y-4 px-4 py-5 md:space-y-5 md:px-8 md:py-8">
      {/* 1. Back link — desktop only (mobile uses bottom nav back) */}
      <div className="hidden items-center gap-1.5 text-[13px] text-muted-foreground md:flex">
        <Link
          href={'/customers' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
          <span>顧客一覧に戻る</span>
        </Link>
      </div>

      {/* 2. Pending-deletion banner — only renders if this customer
       *     is inside the 30-day soft-delete window. Banner returns
       *     null when status.isScheduled is false. */}
      <CustomerDeletionBanner
        customerId={customer.id}
        customerName={customer.name}
      />

      {/* 3. Identity */}
      <CustomerIdentityCard c={customer} />

      {/* 3b. 回数券・サブスク — above the tabs so staff see remaining sessions
       *     + the "残り1回 → next-pack conversation" nudge at a glance. */}
      <TicketPackCard
        customerId={customer.id}
        packs={packs}
        lifecycle={lifecycle}
      />

      {/* 3c. AI re-engagement card — sits ABOVE tabs so staff catch
       *     the draft message on profile open (spike pattern). */}
      <CustomerReengagementPreview />

      {/* 4. Tabs */}
      <CustomerTabBar
        active={tab}
        onChange={setTab}
        counts={{
          memory: customer.memoryCount,
          sessions: customer.sessionCount,
          photos: customer.photoCount,
        }}
      />

      {/* 5. Tab content */}
      <div>
        {tab === 'memory' && (
          <div className="space-y-4 md:space-y-5">
            <BookingMemoCard memo={customer.bookingMemo} />
            <CustomerMemoryCard
              customerName={customer.name}
              pastSessionCount={customer.sessionCount}
              memory={customerMemory}
            />
          </div>
        )}
        {tab === 'sessions' && (
          <div className="space-y-3">
            {/* ⚠️ TEMPORARY build tool — bulk re-run the latest prompts across
             *  this customer's whole karute history. Remove once backfilled. */}
            <div className="flex justify-end">
              <RegenerateAllForCustomerButton customerId={customer.id} />
            </div>
            <SessionsTabContent sessions={sessions} />
          </div>
        )}
        {/* PhotosTabContent renders the real photos prop loaded
         *  server-side via listCustomerPhotos. Read-only thumbnail
         *  grid until uploads ship. ANTHONY: the upload + capture
         *  flow lives in PhotoRecordCard / PhotoCaptureDialog under
         *  spike-lifted/photos/ — those still need wiring against
         *  uploadCustomerPhoto + Storage signed URLs before they're
         *  swapped back in here. */}
        {tab === 'photos' && <PhotosTabContent photos={photos} />}
        {tab === 'privacy' && <PrivacyTabContent customerName={customer.name} />}
      </div>
    </main>
  )
}
