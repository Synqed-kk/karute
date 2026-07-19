// Chrome-DTO store — module singleton (the thin idiom: session-store,
// globalPipeline). One fetch of /screens/chrome per signed-in session feeds
// BOTH chrome mount points (the nav in the shell slot and the header inside
// the AuthGate content) without threading context across the tree.
//
// Best-effort like the web layout's chrome seeding: a failed fetch leaves the
// dto null — the nav renders with the scaffold mic label, the bell shows an
// empty feed, the switcher hides. Screens are unaffected (their own DTOs).

import { useEffect, useSyncExternalStore } from 'react'
import { ChromeScreenDTO, type ChromeScreenDTOType } from '@/lib/app-api/chrome-dto'
import { getDataPort } from '@/lib/ports/data-port'
import {
  getSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'

type ChromeState =
  | { status: 'idle'; dto: null }
  | { status: 'loading'; dto: null }
  | { status: 'ready'; dto: ChromeScreenDTOType }
  | { status: 'error'; dto: null }

let current: ChromeState = { status: 'idle', dto: null }
const listeners = new Set<() => void>()

function set(state: ChromeState): void {
  current = state
  listeners.forEach((l) => l())
}

export function getChromeState(): ChromeState {
  return current
}

export function subscribeChrome(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Fetch once per signed-in session (single-flight; an 'error' state may be
 *  retried by a later call — e.g. the next mount/navigation). */
export function ensureChromeLoaded(): void {
  if (current.status === 'loading' || current.status === 'ready') return
  if (getSessionState().status !== 'signed-in') return
  set({ status: 'loading', dto: null })
  void getDataPort()
    .apiFetch('/api/app/v1/screens/chrome')
    .then(async (res) => {
      if (!res.ok) throw new Error(`chrome ${res.status}`)
      const body: unknown = await res.json()
      const data = (body as { data?: unknown }).data ?? body
      set({ status: 'ready', dto: ChromeScreenDTO.parse(data) })
    })
    .catch(() => {
      if (current.status === 'loading') set({ status: 'error', dto: null })
    })
}

// Sign-out wipes the chrome (customer names, feed) — same shared-device
// hygiene as the packet-10 session vault. Module-level subscription, one per
// bundle lifetime, mirroring thin/auth/session.ts.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out' && current.status !== 'idle') {
    set({ status: 'idle', dto: null })
  }
})

/** Subscribe + lazily load. Returns the dto (null until ready). */
export function useChromeDto(): ChromeScreenDTOType | null {
  const state = useSyncExternalStore(subscribeChrome, getChromeState)
  const session = useSyncExternalStore(subscribeSessionState, getSessionState)
  useEffect(() => {
    ensureChromeLoaded()
  }, [session.status])
  return state.dto
}
