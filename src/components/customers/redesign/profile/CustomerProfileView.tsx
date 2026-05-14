'use client'

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
