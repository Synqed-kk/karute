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
import { emitRefresh } from '../ports/nav.vite'
import { getThinActiveStore, setThinActiveStore } from './store-pref'

type ChromeState =
  | { status: 'idle'; dto: null }
  | { status: 'loading'; dto: null }
  | { status: 'ready'; dto: ChromeScreenDTOType }
  | { status: 'error'; dto: null }

let current: ChromeState = { status: 'idle', dto: null }
// Bumped on every sign-out reset: a fetch that was in flight when the user
// signed out must NOT write the PREVIOUS user's chrome (customer names, feed)
// into the store after the reset — the packet-10 shared-device leak class.
// Same discipline as globalPipeline.runId.
let epoch = 0
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
  const myEpoch = epoch
  set({ status: 'loading', dto: null })
  void getDataPort()
    .apiFetch('/api/app/v1/screens/chrome')
    .then(async (res) => {
      if (!res.ok) throw new Error(`chrome ${res.status}`)
      const body: unknown = await res.json()
      const data = (body as { data?: unknown }).data ?? body
      const dto = ChromeScreenDTO.parse(data)
      if (epoch !== myEpoch) return // superseded by a sign-out reset
      seedStoreLens(dto)
      set({ status: 'ready', dto })
    })
    .catch(() => {
      if (epoch === myEpoch && current.status === 'loading')
        set({ status: 'error', dto: null })
    })
}

// Fresh-install store lens (design-parity Gap B½): the web defaults an unset
// active-store cookie to the PRIMARY store (resolveStoreScope), but the facade
// clamp reads a missing store-id header as unrestricted-in-tenant — so a
// multi-store owner's first boot mixed every branch on every screen while the
// switcher DISPLAYED the primary as active. Seed the pref to match. Gates:
// pref unset (never override a pinned lens) AND activeStoreId null (a clamped
// staff's server default is their OWN store — seeding the tenant primary
// would fail their clamp closed on every request).
function seedStoreLens(dto: ChromeScreenDTOType): void {
  if (getThinActiveStore() !== null || dto.activeStoreId !== null) return
  const primary = dto.stores.find((s) => s.isPrimary)
  if (!primary) return
  setThinActiveStore(primary.id)
  // Screens that fetched before the seed rendered unlensed — re-fetch them
  // through the new lens, stale-while-revalidate (the router.refresh path).
  emitRefresh()
}

// Sign-out wipes the chrome (customer names, feed) — same shared-device
// hygiene as the packet-10 session vault. Module-level subscription, one per
// bundle lifetime, mirroring thin/auth/session.ts.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out' && current.status !== 'idle') {
    epoch++ // invalidate any in-flight fetch (see the epoch note above)
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
