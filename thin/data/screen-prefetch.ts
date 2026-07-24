// Background screen-DTO prefetch on app open (perf packet 34, PR-H). #589's
// dtoCache (ScreenBoundary.tsx) only speeds up REVISITS — the first tap of
// any tab this session always pays a full facade RTT and shows 読み込み中.
// While staff look at the first screen after sign-in, this silently
// pre-loads the OTHER screens' DTOs in the background (mirrors brief-warm.ts's
// singleton/stagger/one-shot idioms and ScreenBoundary's generation fence),
// so every first tap this session paints instantly instead of shimmering.
//
// Recording safety: the trigger below is the boot sign-in settle — no
// recording can be active at that point (the recorder only starts from a
// mounted RecordScreen), so there is no runtime coupling to check.
//
// brief-warm stays the appointments screen's job: the appointments prefetch
// below deliberately does NOT call warmBriefsForToday on its DTO settle —
// prefetching N brief warms from a background DTO would double the AI-warm
// fan-out Liam already approved as-is.

import { getDataPort } from '@/lib/ports/data-port'
import { RecordScreenDTO } from '@/lib/app-api/record-screen-dto'
import { AppointmentsScreenDTO } from '@/lib/app-api/appointments-screen-dto'
import { CustomersScreenDTO } from '@/lib/app-api/customers-screen-dto'
import { SessionsScreenDTO } from '@/lib/app-api/sessions-screen-dto'
import { DashboardScreenDTO } from '@/lib/app-api/dashboard-screen-dto'
import {
  currentGeneration,
  getSessionState,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { cacheDto, dtoCache } from '../screens/ScreenBoundary'

const FIRST_DELAY_MS = 3_000
const STAGGER_MS = 4_000

type Target = { path: string; parse: (raw: unknown) => unknown }

// Feel-impact order (packet table) — the mounted screen's own mount-effect
// fetch always wins first paint (ScreenBoundary fetches on mount regardless
// of cache state), so this order only decides which OTHER screen warms
// soonest. Paths are byte-pinned in tests against each screen's own literal.
const TARGETS: Target[] = [
  {
    path: '/api/app/v1/screens/record?locale=ja',
    parse: (raw) => RecordScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/appointments?locale=ja',
    parse: (raw) => AppointmentsScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/customers',
    parse: (raw) => CustomersScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/sessions',
    parse: (raw) => SessionsScreenDTO.parse(raw),
  },
  {
    path: '/api/app/v1/screens/dashboard',
    parse: (raw) => DashboardScreenDTO.parse(raw),
  },
]

// Exported for the packet's byte-pin tests — same rationale ScreenBoundary's
// dtoCache export gives: pin each cache-key path directly against the
// literal the owning screen builds, so a drift is a red test, not a silent
// zero-benefit prefetch.
export const PREFETCH_PATHS: readonly string[] = TARGETS.map((t) => t.path)

// One-shot per sign-in generation (Liam's "don't do it repetitively" ruling):
// the generation the batch already fired for. A token rotation or any other
// notify that leaves the generation unchanged (session-store only advances
// it on an authoritative setSessionState transition) schedules nothing; a
// genuine new sign-in opens a new generation and re-arms.
let firedForGeneration: number | null = null
let pendingTimers: number[] = []

function schedule(): void {
  const gen = currentGeneration()
  if (firedForGeneration === gen) return
  firedForGeneration = gen
  let i = 0
  for (const { path, parse } of TARGETS) {
    // Skip at schedule time: already visited (or already prefetched, e.g. a
    // straggler batch from a prior settle this generation).
    if (dtoCache.has(path)) continue
    const delay = FIRST_DELAY_MS + i * STAGGER_MS
    i++
    const timer = window.setTimeout(() => {
      pendingTimers = pendingTimers.filter((t) => t !== timer)
      // Skip at fire time too: a user who navigated there mid-stagger
      // already has a fresher fetch in the cache — never clobber it.
      if (dtoCache.has(path)) return
      // Captured at fetch START, mirroring ScreenBoundary/brief-cache's
      // straggler fence — a sign-out mid-flight must not let this settle
      // write into the replacement session's cache.
      const myGen = currentGeneration()
      getDataPort()
        .apiFetch(path)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => {
          if (body === null) return
          const dto = parse(body)
          if (currentGeneration() === myGen && !dtoCache.has(path)) cacheDto(path, dto)
        })
        // Fail-open, no retry: a non-OK response, a network rejection, a
        // JSON parse failure, and a zod schema-parse failure all land here
        // silently — the real tap's own fetch surfaces any genuine error.
        .catch(() => {})
    }, delay)
    pendingTimers.push(timer)
  }
}

subscribeSessionState(() => {
  const state = getSessionState()
  if (state.status === 'signed-in') {
    schedule()
  } else if (state.status === 'signed-out') {
    // Shared-device hygiene (brief-warm.ts's reset idiom): a different staff
    // member's sign-in must re-arm from a clean slate, and no stale timer
    // from the outgoing session may fire into the new one.
    pendingTimers.forEach((t) => window.clearTimeout(t))
    pendingTimers = []
    firedForGeneration = null
  }
})
