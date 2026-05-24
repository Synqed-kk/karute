'use client'

// Layout philosophy:
//   - Keep karute's existing tab structure (Memory / Sessions / Photos /
//     Privacy) — that's Anthony's work, don't remove it.
//   - ADD spike-like sections ABOVE the tabs as new placeholder
//     surfaces. Anthony decides whether to wire each one, keep as
//     "Coming Soon", or restructure.
//   - Spike's visual design (flat sections, no floating cards,
//     edge-to-edge on mobile, carded on desktop) applied to the new
//     additions + the existing identity header.
//
// Section order (top-to-bottom):
//   1. Back link
//   2. CustomerIdentityCard      (= spike CustomerHeaderCard, flat)
//   3. PhotoRecordCard           (lifted from spike, step 1)
//   4. AI Body Prediction + AI Outreach   (2-col on lg+)
//   5. AI Summary + Recording Transcript  (2-col on lg+)
//   6. Tab bar                   (Anthony's: Memory / Sessions /
//                                  Photos / Privacy)
//   7. Tab content for the selected tab
//
// ANTHONY: as each spike placeholder lands as a real lift, drop the
// placeholder import and swap in the real component at the same
// position — the section grid itself doesn't move. Tabs untouched.

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
  photos: CustomerPhoto[]
}

export function CustomerProfileView({
  customer,
  sessions,
  photos,
}: CustomerProfileViewProps) {
  const [tab, setTab] = useState<CustomerProfileTab>('memory')

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

      {/* 1. Identity — flat section (no box, matches spike) */}
      <CustomerIdentityCard c={customer} />

      {/* 2. Photo records — lifted from spike (step 1). */}
      <div className="md:px-6 md:pt-5">
        <PhotoRecordCard customerName={customer.name} />
      </div>

      {/* 3. AI body prediction + AI outreach — 2-col on lg, stacked
       *  on smaller. Spike: `lg:grid-cols-2` row. */}
      <div className="md:px-6 md:pt-5 md:pb-5 md:grid md:grid-cols-1 lg:grid-cols-2 md:gap-3">
        <AIBodyPredictionPreview />
        <AIOutreachPreview />
      </div>

      {/* 4. AI summary + Recording transcript — also 2-col on lg.
       *  Spike puts these in a desktop sidebar next to the session
       *  entries; here they sit as their own 2-col row above the
       *  tab bar so the tabs (Anthony's structure) stay visible
       *  and reachable below. */}
      <div className="md:px-6 md:pb-5 md:grid md:grid-cols-1 lg:grid-cols-2 md:gap-3">
        <AISummaryPreview />
        <RecordingTranscriptPreview />
      </div>

      {/* 5. Tabs — Anthony's structure. KEPT IN PLACE. Memory /
       *  Sessions / Photos / Privacy tab pattern stays as-is for
       *  deeper navigation; the AI placeholders above are
       *  additions, not replacements. */}
      <div className="px-4 pt-2 md:px-6 md:pt-3">
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
    </main>
  )
}
