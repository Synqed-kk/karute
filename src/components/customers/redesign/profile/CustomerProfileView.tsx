'use client'

// Restructured to match the design spike's karute-detail page layout:
// edge-to-edge stacked sections on mobile, each section providing its
// own bg-card + border-b for visual separation. Previously each section
// floated as a `rounded-2xl border bg-card shadow-sm` card with `gap-4`
// between them and `p-4` outer padding — which wasted horizontal space
// at the screen edges and gave the page a "fragmented" feel vs the
// spike's continuous vertical stack.
//
// Wrapper now has zero mobile padding (sections handle their own
// internal px). Desktop keeps a small max-width + bottom padding;
// inner sections retain their desktop card chrome where appropriate
// (UpcomingAiFeatures still grids into cards on md:+, photo card
// still rounds on md:+).

import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { CustomerProfileData } from '../types'
import { CustomerIdentityCard } from './CustomerIdentityCard'
import { CustomerTabBar, type CustomerProfileTab } from './CustomerTabBar'
import { MemoryTabContent } from './MemoryTabContent'
import {
  SessionsTabContent,
  type CustomerSessionEntry,
} from './SessionsTabContent'
import {
  PhotosTabContent,
  type CustomerPhoto,
} from './PhotosTabContent'
import { PrivacyTabContent } from './PrivacyTabContent'
import { UpcomingAiFeatures } from './UpcomingAiFeatures'
import { PhotoRecordCard } from '@/components/karute/spike-lifted/photos/PhotoRecordCard'

interface CustomerProfileViewProps {
  customer: CustomerProfileData
  sessions: CustomerSessionEntry[]
  photos: CustomerPhoto[]
}

export function CustomerProfileView({
  customer,
  sessions,
  photos,
}: CustomerProfileViewProps) {
  const [tab, setTab] = useState<CustomerProfileTab>('memory')

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col pb-6 md:gap-4 md:py-6">
      {/* Back link — small sticky-ish top affordance, never carded */}
      <div className="px-4 pt-3 md:px-0 md:pt-0">
        <Link
          href={'/customers' as Parameters<typeof Link>[0]['href']}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={14} />
          <span>顧客一覧へ</span>
        </Link>
      </div>

      {/* Identity — flat section, edge-to-edge on mobile */}
      <CustomerIdentityCard c={customer} />

      {/* Photo records — flat on mobile, carded on desktop (spike pattern) */}
      <PhotoRecordCard customerName={customer.name} />

      {/* AI surface — 4 Coming Soon placeholders for spike's AI cards */}
      <UpcomingAiFeatures />

      {/* Memory / Sessions / Photos / Privacy tabs.
       *  Tab bar + tab content keep their own padding so they sit cleanly
       *  inside the flat layout. Note (for Anthony): the spike doesn't
       *  use tabs here — it stacks the equivalent sections vertically
       *  (CustomerMemoryCard / SessionEntryTimeline / PhotoRecordCard
       *  inline). Whether to drop the tabs in favor of the spike's
       *  stacked sections is a bigger design decision and a separate
       *  refactor. */}
      <div className="px-4 md:px-0">
        <CustomerTabBar
          active={tab}
          onChange={setTab}
          counts={{
            memory: customer.memoryCount,
            sessions: customer.sessionCount,
            photos: customer.photoCount,
          }}
        />
        <div className="mt-3">
          {tab === 'memory' && <MemoryTabContent />}
          {tab === 'sessions' && <SessionsTabContent sessions={sessions} />}
          {tab === 'photos' && <PhotosTabContent photos={photos} />}
          {tab === 'privacy' && <PrivacyTabContent customerName={customer.name} />}
        </div>
      </div>
    </div>
  )
}
