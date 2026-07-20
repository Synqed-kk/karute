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

async function fetchChromeDto(): Promise<ChromeScreenDTOType> {
  const res = await getDataPort().apiFetch('/api/app/v1/screens/chrome')
  if (!res.ok) throw new Error(`chrome ${res.status}`)
  const body: unknown = await res.json()
  const data = (body as { data?: unknown }).data ?? body
  return ChromeScreenDTO.parse(data)
}

/** Fetch once per signed-in session (single-flight; an 'error' state may be
 *  retried by a later call — e.g. the next mount/navigation). */
export function ensureChromeLoaded(): void {
  if (current.status === 'loading' || current.status === 'ready') return
  if (getSessionState().status !== 'signed-in') return
  const myEpoch = epoch
  set({ status: 'loading', dto: null })
  void fetchChromeDto()
    .then((dto) => {
      if (epoch !== myEpoch) return // superseded by a sign-out reset
      const seeded = seedStoreLens(dto)
      set({ status: 'ready', dto })
      // The dto that TRIGGERED the seed was fetched unlensed — its feed is
      // business-wide, and with no re-fetch until sign-out/relaunch the bell
      // would stay that way for the WHOLE first session. One lensed re-fetch;
      // loop-safe by construction: the next response cannot seed again (the
      // pref is now set → seed gate 1 blocks).
      if (seeded) refetchLensedChrome(myEpoch)
    })
    .catch(() => {
      if (epoch === myEpoch && current.status === 'loading')
        set({ status: 'error', dto: null })
    })
}

// Silent revalidate: keeps the rendered (unlensed) chrome on failure — same
// best-effort posture as the chrome fetch itself.
function refetchLensedChrome(myEpoch: number): void {
  void fetchChromeDto()
    .then((dto) => {
      if (epoch !== myEpoch) return
      set({ status: 'ready', dto })
    })
    .catch(() => {})
}

// Mid-session heal convergence (fleet round 2, P1): when the stranded-pin
// self-heal clears the pref while chrome is already 'ready', nothing above
// re-runs — the switcher keeps displaying the dead store until relaunch while
// every read runs unlensed (owners: all branches mixed; walk-in karute saves
// could write store_id null). Re-run the fetch+seed pipeline: the fresh dto
// snaps the switcher to the server's truth, and for viewAll callers the seed
// re-pins the primary + emitRefresh re-scopes every screen. Boot-time heals
// converge through the in-flight chrome fetch — skip unless 'ready'.
// Single-flight: N concurrent heals nudge once. Failure keeps the rendered
// chrome (best-effort posture above); a later heal may nudge again.
let resyncing = false
export function resyncChromeAfterHeal(): void {
  if (current.status !== 'ready' || resyncing) return
  const myEpoch = epoch
  resyncing = true
  void fetchChromeDto()
    .then((dto) => {
      if (epoch !== myEpoch) return
      const seeded = seedStoreLens(dto)
      set({ status: 'ready', dto })
      if (seeded) refetchLensedChrome(myEpoch)
    })
    .catch(() => {})
    .finally(() => {
      resyncing = false
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
function seedStoreLens(dto: ChromeScreenDTOType): boolean {
  if (getThinActiveStore() !== null || dto.activeStoreId !== null) return false
  const primary = dto.stores.find((s) => s.isPrimary)
  if (!primary) return false
  setThinActiveStore(primary.id)
  // localStorage can silently refuse the persist (private mode / quota — the
  // setter swallows it by design). Only report seeded when the pin actually
  // stuck: a false `true` fires the lensed re-fetch + every screen's refresh
  // for a lens that does not exist (fleet round 2, P3).
  if (getThinActiveStore() !== primary.id) return false
  // Screens that fetched before the seed rendered unlensed — re-fetch them
  // through the new lens, stale-while-revalidate (the router.refresh path).
  emitRefresh()
  return true
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
