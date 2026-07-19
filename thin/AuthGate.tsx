// Auth gate for the thin shell (packet-01 boot gate, the renderable half).
// Three explicit states from the session-store, exactly the boot-gate
// contract: signed-in → the app; signed-out → login; recovering → the shared
// loading state (pre-boot default, offline recovery, resume single-flight).
// First paint is never blocked: 'recovering' renders immediately and the gate
// re-renders when boot/recovery settles.

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import {
  getSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { LoginScreen } from './screens/LoginScreen'
import { ScreenLoading } from './screens/ScreenBoundary'

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeSessionState, getSessionState)
  if (state.status === 'signed-out') return <LoginScreen />
  if (state.status === 'recovering') return <ScreenLoading />
  return <>{children}</>
}
