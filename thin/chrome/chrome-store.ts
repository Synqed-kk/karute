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
  hasKnownSession,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { globalPipeline, type PipelineState } from '@/lib/global-pipeline'
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
// Single-flight for the recovering-window error escape (see the catch in
// ensureChromeLoaded).
let errorRetryArmed = false
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
  // Same mounted-app contract as AuthGate/ThinChromeNav (packet 25 round-3
  // fix): the boot seed makes recovering-with-known-session the normal COLD
  // BOOT state, and gating chrome on full 'signed-in' left the nav/header
  // empty while screens filled — chrome must load whenever the app is
  // mounted. A failure on a stale seeded Bearer lands in 'error'; a settle
  // that CHANGES session.status re-arms via useChromeDto's effect, and a
  // recovering→recovering timeout echo (same string — invisible to that
  // effect) is covered by the one-shot next-write escape in the catch below.
  const session = getSessionState()
  const mounted =
    session.status === 'signed-in' ||
    (session.status === 'recovering' && hasKnownSession())
  if (!mounted) return
  const myEpoch = epoch
  // Captured for the settle-race branch in the catch below (Greptile #596
  // P1): a settle that lands DURING this fetch flips the status before the
  // stale-Bearer failure arrives.
  const startedStatus = session.status
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
      if (epoch === myEpoch && current.status === 'loading') {
        set({ status: 'error', dto: null })
        // Round-3 focused-verify P1: a fetch that failed during the seeded
        // 'recovering' window needs an escape that survives the boot
        // timeout's recovering→recovering echo — same status STRING, so
        // useChromeDto's [session.status] effect never re-fires on it
        // (ScreenBoundary's grace escape solved this identically). One
        // shot, module-level: the NEXT store write of ANY kind retries;
        // ensureChromeLoaded re-checks every gate itself (a sign-out write
        // lands on mounted=false and no-ops). Writes are sparse (settle,
        // echo, rotation, sign-out) — no retry storm. If the fetch failed
        // SLOWER than the boot timeout (bare fetch, no client abort), the
        // boot echo has already passed — the escape then rides the next
        // write from a foreground resume echo / rotation / settle instead;
        // unbounded wait only in the already-degraded fully-offline case,
        // where a retry could not succeed anyway.
        const statusNow = getSessionState().status
        if (!errorRetryArmed && statusNow === 'recovering') {
          errorRetryArmed = true
          const unsub = subscribeSessionState(() => {
            unsub()
            errorRetryArmed = false
            ensureChromeLoaded()
          })
        } else if (statusNow === 'signed-in' && statusNow !== startedStatus) {
          // Settle-race escape (Greptile #596 P1): the session settled to
          // signed-in WHILE this recovering-window fetch was in flight — so
          // useChromeDto's [session.status] effect already fired into the
          // 'loading' guard and was skipped, and the recovering-only arm
          // above can't fire either. The failure was the stale seeded
          // Bearer; retry once immediately with the settled token. Storm-
          // safe by construction: the retry captures startedStatus =
          // 'signed-in', so ITS failure lands on statusNow === startedStatus
          // and stops here (today's behavior — foreground/next write heals).
          ensureChromeLoaded()
        }
      }
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

// NEW-2 (field triage 8/19): the idle mic label's next customer is baked into
// the chrome DTO, and this store fetches that DTO exactly ONCE per signed-in
// session — nothing recording-related ever refetches, so after a session was
// recorded the label kept naming the customer who had already left, all shift.
// Refetch when a pipeline run ENDS: 'idle' (saved or discarded) or 'error'
// (the errored-run case NEW-2 was actually reported on). One GET per run end,
// and an ERRORED run ends twice — once when the error card appears, once when
// the staff dismisses it (error → idle). The post-dismiss GET is kept
// deliberately: it is the only one that can pick up a recovery-banner save
// made while the error card was up. No polling, no timers.
// Silent + best-effort like refetchLensedChrome: a failure keeps the rendered
// chrome. No seedStoreLens — seeding is a heal/first-boot concern, not this.
// Web is untouched: its chrome is server-fetched per navigation.
let refreshingAfterRun = false
function refreshChromeAfterRun(): void {
  if (current.status !== 'ready' || refreshingAfterRun) return
  const myEpoch = epoch
  refreshingAfterRun = true
  void fetchChromeDto()
    .then((dto) => {
      if (epoch !== myEpoch) return
      set({ status: 'ready', dto })
    })
    .catch(() => {})
    .finally(() => {
      refreshingAfterRun = false
    })
}

// Module-level subscription, one per bundle lifetime — same idiom as the
// sign-out block below. The pipeline notifies on every step, so fire on the
// TRANSITION into an end state only; a run that was already idle/errored has
// produced nothing new for the chrome to show.
let prevPipelineState: PipelineState = globalPipeline.state
globalPipeline.subscribe(() => {
  const next = globalPipeline.state
  const ended =
    (next === 'idle' && prevPipelineState !== 'idle') ||
    (next === 'error' && prevPipelineState !== 'error')
  prevPipelineState = next
  if (ended) refreshChromeAfterRun()
})

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
    // …and clear the single-flight flags with it: neither fetch aborts (bare
    // fetch, no AbortController), so a hung one would otherwise leave its flag
    // true for the platform timeout and silently eat the NEXT legitimate
    // refetch — on a shared salon device that is the next user's run end.
    refreshingAfterRun = false
    resyncing = false
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
