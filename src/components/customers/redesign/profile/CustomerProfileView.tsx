'use client'

import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import type { CustomerProfileData } from '../types'
import { CustomerIdentityCard } from './CustomerIdentityCard'
import { CustomerTabBar, type CustomerProfileTab } from './CustomerTabBar'
import { MemoryTabContent } from './MemoryTabContent'
import { UpcomingAiFeatures } from './UpcomingAiFeatures'
import { PhotoRecordCard } from '@/components/karute/spike-lifted/photos/PhotoRecordCard'
import {
  SessionsTabContent,
  type CustomerSessionEntry,
} from './SessionsTabContent'
import {
  PhotosTabContent,
  type CustomerPhoto,
} from './PhotosTabContent'
import { PrivacyTabContent } from './PrivacyTabContent'

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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <Link
        href={'/customers' as Parameters<typeof Link>[0]['href']}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={14} />
        <span>Back to customers</span>
      </Link>

      <CustomerIdentityCard c={customer} />

      {/* Photo records — lifted from the design spike (visual + button
       *  scaffolding). Sample placeholder images render via picsum.photos
       *  until Anthony wires Supabase Storage. Buttons currently open
       *  a Coming-Soon dialog; full gallery + capture + compare-overlay
       *  views are the next lift step. See
       *  src/components/karute/spike-lifted/photos/PhotoRecordCard.tsx
       *  for ANTHONY notes on the integration swap. */}
      <PhotoRecordCard customerName={customer.name} />

      {/* AI surface — visual placeholders for the four AI features
       *  shipped on the design spike's karute detail page but not yet
       *  wired here (体調予測 / 推奨メッセージ / 要約 / 録音・文字起こし).
       *  See UpcomingAiFeatures.tsx for per-card ANTHONY notes pointing
       *  at the spike source files + AI_INTEGRATION_SPEC sections.
       *  Drop or replace each preview as the real implementation lands. */}
      <UpcomingAiFeatures />

      <CustomerTabBar
        active={tab}
        onChange={setTab}
        counts={{
          memory: customer.memoryCount,
          sessions: customer.sessionCount,
          photos: customer.photoCount,
        }}
      />

      <div>
        {tab === 'memory' && <MemoryTabContent />}
        {tab === 'sessions' && <SessionsTabContent sessions={sessions} />}
        {tab === 'photos' && <PhotosTabContent photos={photos} />}
        {tab === 'privacy' && <PrivacyTabContent customerName={customer.name} />}
      </div>
    </div>
  )
}
