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
import { CustomerTabBar, type CustomerProfileTab } from './CustomerTabBar'
import { CustomerMemoryCard } from '@/components/karute/spike-lifted/memory/CustomerMemoryCard'
import {
  SessionsTabContent,
  type CustomerSessionEntry,
} from './SessionsTabContent'
import { type CustomerPhoto } from './PhotosTabContent'
import { PrivacyTabContent } from './PrivacyTabContent'
import { CustomerReengagementPreview } from './UpcomingAiFeatures'
import { PhotoRecordCard } from '@/components/karute/spike-lifted/photos/PhotoRecordCard'

interface CustomerProfileViewProps {
  customer: CustomerProfileData
  sessions: CustomerSessionEntry[]
  /** Reserved for the lifted PhotoGallerySheet (step 2 of the photo
   *  lift). PhotoRecordCard currently reads from its own placeholder
   *  store and ignores this prop. */
  photos: CustomerPhoto[]
}

export function CustomerProfileView({
  customer,
  sessions,
  photos: _photos,
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

      {/* 2. Identity */}
      <CustomerIdentityCard c={customer} />

      {/* 3. AI re-engagement card — sits ABOVE tabs so staff catch
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
        {tab === 'memory' && <CustomerMemoryCard customerName={customer.name} />}
        {tab === 'sessions' && <SessionsTabContent sessions={sessions} />}
        {tab === 'photos' && <PhotoRecordCard customerName={customer.name} />}
        {tab === 'privacy' && <PrivacyTabContent customerName={customer.name} />}
      </div>
    </main>
  )
}
