'use client'

import { createContext, useContext } from 'react'
import type { OrgContextValue } from '@/lib/types/org'

const OrgContext = createContext<OrgContextValue>(null)

// Mock data — will be replaced with real Supabase query
const MOCK_ORG_CONTEXT: OrgContextValue = {
  org: {
    id: 'org_mock_001',
    name: 'さくら整体院',
    plan: 'pro',
  },
  staff: {
    id: 'staff_mock_001',
    name: '田中太郎',
    role: 'owner',
  },
}

export function OrgProvider({ children }: { children: React.ReactNode }) {
  return (
    <OrgContext.Provider value={MOCK_ORG_CONTEXT}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  const context = useContext(OrgContext)
  if (!context) {
    throw new Error('useOrg must be used within an OrgProvider')
  }
  return context
}
