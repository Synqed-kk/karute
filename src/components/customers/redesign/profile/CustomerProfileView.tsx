'use client'

// LAYOUT STRUCTURE: mirrored from spike's KaruteDetailPage
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/app/[locale]/(app)/karute/page.tsx
//
// Section order, responsive grid breakpoints, and section spacing all
// match the spike's vertical stack. Tabs (Memory/Sessions/Photos/
// Privacy) are GONE — the spike doesn't use them. Each former tab's
// content now renders inline as its own section, matching how staff
// actually consume the page (everything visible at once, glance from
// top to bottom). This is Liam's "just copy the spike's layout"
// directive after several rounds of incremental fixes that weren't
// landing the structural match.
//
// Section order (top-to-bottom):
//   1. Back link
//   2. CustomerIdentityCard      (= spike CustomerHeaderCard)
//   3. Customer memory section   (= spike CustomerMemoryCard;
//                                   currently the stub MemoryTabContent
//                                   placeholder — replace with a lifted
//                                   spike CustomerMemoryCard later)
//   4. PhotoRecordCard            (lifted from spike, step 1)
//   5. AI Body Prediction + AI Outreach (2-col on lg+, stacked on
//      smaller; matches spike's `lg:grid-cols-2` row)
//   6. Session entries + AI summary + Recording transcript
//      (main + sidebar on lg+; matches spike's
//      `lg:grid-cols-[1.4fr_1fr]` row)
//   7. Privacy section            (= karute's existing PrivacyTabContent,
//                                   inlined since it was tab-bound before)
//
// ANTHONY: as each spike component lands as a real lift (replacing
// its placeholder), drop the placeholder import and swap in the real
// component at the same position — the section grid itself doesn't
// move.

import { ChevronLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { CustomerProfileData } from '../types'
import { CustomerIdentityCard } from './CustomerIdentityCard'
import { MemoryTabContent } from './MemoryTabContent'
import {
  SessionsTabContent,
  type CustomerSessionEntry,
} from './SessionsTabContent'
import { type CustomerPhoto } from './PhotosTabContent'
import { PrivacyTabContent } from './PrivacyTabContent'
import {
  AIBodyPredictionPreview,
  AIOutreachPreview,
  AISummaryPreview,
  RecordingTranscriptPreview,
} from './UpcomingAiFeatures'
import { PhotoRecordCard } from '@/components/karute/spike-lifted/photos/PhotoRecordCard'

interface CustomerProfileViewProps {
  customer: CustomerProfileData
  sessions: CustomerSessionEntry[]
  /**
   * Kept on the props for now even though PhotoRecordCard ignores it
   * (it reads from its own placeholder store). When the lifted
   * PhotoGallerySheet lands, photos param flows back in.
   */
  photos: CustomerPhoto[]
}

export function CustomerProfileView({
  customer,
  sessions,
  photos: _photos,
}: CustomerProfileViewProps) {
  return (
    <main className="mx-auto w-full max-w-[1280px] pb-10">
      {/* Back link — slim top bar, never carded */}
      <div className="px-4 pt-3 md:px-6 md:pt-4">
        <Link
          href={'/customers' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} />
          <span>顧客一覧へ</span>
        </Link>
      </div>

      {/* 1. Identity header — flat section (spike: CustomerHeaderCard) */}
      <CustomerIdentityCard c={customer} />

      {/* 2. Customer memory — spike: CustomerMemoryCard.
       *  Placeholder uses karute's existing stubbed MemoryTabContent.
       *  Replace with lifted spike component when memory pipeline is
       *  ready. Wrapper provides desktop-only inset matching spike. */}
      <div className="md:px-6 md:pt-5">
        <MemoryTabContent />
      </div>

      {/* 3. Photo records — lifted from spike (step 1). Internal
       *  responsive chrome already matches spike. */}
      <div className="md:px-6 md:pt-5">
        <PhotoRecordCard customerName={customer.name} />
      </div>

      {/* 4. AI body prediction + AI outreach — 2-col on lg, stacked
       *  on smaller. Spike: `lg:grid-cols-2 md:gap-4` row. */}
      <div className="md:px-6 md:pt-5 md:pb-5 md:grid md:grid-cols-1 lg:grid-cols-2 md:gap-3">
        <AIBodyPredictionPreview />
        <AIOutreachPreview />
      </div>

      {/* 5. Session entries timeline (main) + AI summary + transcript
       *  (sidebar). Spike's `lg:grid-cols-[1.4fr_1fr]` layout. On
       *  smaller viewports everything stacks naturally. */}
      <div className="md:px-6 md:pb-5">
        <div className="md:grid md:grid-cols-1 lg:grid-cols-[1.4fr_1fr] md:gap-5">
          {/* Main column: session entries (currently karute's
           *  SessionsTabContent — lifts to spike's
           *  SessionEntryTimeline + EntryComposer eventually) */}
          <div className="md:rounded-lg md:bg-card md:p-4 md:ring-1 md:ring-black/5 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)] md:dark:ring-white/5 md:dark:shadow-none">
            <SessionsTabContent sessions={sessions} />
          </div>

          {/* Sidebar: AI summary + transcript (Coming Soon placeholders) */}
          <div className="space-y-3 md:space-y-4">
            <AISummaryPreview />
            <RecordingTranscriptPreview />
          </div>
        </div>
      </div>

      {/* 6. Privacy & data — sits at bottom (spike's karute detail
       *  doesn't have a privacy section; karute does, keep it
       *  visible). Desktop inset matches the rest of the stack. */}
      <div className="md:px-6 md:pt-5">
        <PrivacyTabContent customerName={customer.name} />
      </div>
    </main>
  )
}
