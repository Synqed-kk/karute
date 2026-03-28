'use client'

import { createContext, useContext, type ReactNode } from 'react'

export interface StaffItem {
  id: string
  name: string
  displayRole?: string
  avatarUrl?: string
  hasPin?: boolean
}

export interface SessionData {
  userId: string
  staffList: StaffItem[]
  activeStaff: StaffItem | null
  activeStaffId: string | null
  locale: string
}

const SessionContext = createContext<SessionData | null>(null)

export function SessionProvider({ data, children }: { data: SessionData; children: ReactNode }) {
  return <SessionContext.Provider value={data}>{children}</SessionContext.Provider>
}

export function useSession(): SessionData {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error('useSession must be used within SessionProvider')
  return ctx
}
