// Auth gate for the thin shell (packet-01 boot gate, the renderable half).
// Three explicit states from the session-store, exactly the boot-gate
// contract: signed-in → the app; signed-out → login; recovering → depends on
// history. First paint is never blocked: 'recovering' renders immediately and
// the gate re-renders when boot/recovery settles.
//
// 'recovering' WITH a known session keeps the app MOUNTED: an offline resume
// times out into 'recovering' (and the spike proved getSession can hang there
// indefinitely) — replacing a signed-in user's work with a spinner would turn
// a network blip into a full-app lockout mid-shift. The DataPort keeps serving
// the last-known Bearer through the spell; only a cold boot (no session yet)
// shows the full-screen loading state.

import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import {
  getSessionState,
  hasKnownSession,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { LoginScreen } from './screens/LoginScreen'
import { ScreenLoading } from './screens/ScreenBoundary'

export function AuthGate({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeSessionState, getSessionState)
  if (state.status === 'signed-out') return <LoginScreen />
  if (state.status === 'recovering' && !hasKnownSession()) return <ScreenLoading />
  return <>{children}</>
}
