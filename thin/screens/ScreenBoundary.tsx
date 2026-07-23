// Shared fetch-on-mount boundary for thin screens (packet 04 router seed).
// One tiny state machine — loading / error+retry / ready — so each screen
// wrapper is just "fetch DTO, validate, render view". No route-level data
// magic per the packet: screens fetch via the DataPort on mount.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { getDataPort } from '@/lib/ports/data-port'
import {
  currentGeneration,
  getSessionState,
  isSeedPendingVerification,
  subscribeSessionState,
} from '@/lib/auth/mobile/session-store'
import { subscribeRefresh, subscribeRevalidate } from '../ports/nav.vite'

type State<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  // `path` = the URL this dto belongs to, so a failed SAME-path re-fetch can
  // keep it while a failed fetch for a NEW path still errors honestly.
  | { status: 'ready'; dto: T; path: string }

/** Carries the HTTP status onto the thrown fetch error (packet 25 fix F2) so
 *  the catch below can detect a 401 by STATUS, never by string-matching the
 *  message. */
class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

// Screen DTO memory cache (packet 24 PR-A): instant revisit paint. ThinRouter
// fully unmounts a screen per tab switch, so without this every revisit paid
// a full network RTT before pixels changed even seconds after last seeing it.
// Stores the PARSED dto (parse already ran once when it was cached — do not
// re-run it on a cache hit). No TTL: the mount effect below always revalidates
// in the background, so staleness self-heals on every visit.
// Exported for the packet's cache tests (cap eviction, retry-delete) to probe
// directly without spinning up a render for every scenario.
const DTO_CACHE_CAP = 50
export const dtoCache = new Map<string, unknown>()

// Foreground revalidate (perf packet 29): per-path staleness, mirrored 1:1
// with dtoCache so the two maps never diverge. 30s = the fresh end of Liam's
// ruled 30–60s band; a hop-away-and-back inside 30s costs zero network.
// Exported for the packet's hygiene tests, same rationale as dtoCache's export.
const STALE_MS = 30_000
export const fetchedAtByPath = new Map<string, number>()

export function cacheDto(path: string, dto: unknown): void {
  if (dtoCache.size >= DTO_CACHE_CAP && !dtoCache.has(path)) {
    const oldest = dtoCache.keys().next().value as string | undefined
    if (oldest !== undefined) {
      dtoCache.delete(oldest)
      fetchedAtByPath.delete(oldest)
    }
  }
  dtoCache.set(path, dto)
  fetchedAtByPath.set(path, Date.now())
}

// SHARED-IPAD LEAK GUARD: a signed-out transition wipes every cached DTO so
// the next user (any user switch passes through 'signed-out' first) never
// paints the outgoing user's data on first frame. Subscribed ONCE at module
// scope — not per hook call. The store-lens SWITCH is covered by
// construction, not here: the switcher does a full WebView reload
// (actions.vite.ts:714), so this module's state (including dtoCache) already
// dies with it.
subscribeSessionState(() => {
  if (getSessionState().status === 'signed-out') {
    dtoCache.clear()
    fetchedAtByPath.clear()
  }
})

/** Fetch a facade screen DTO on mount; parse enforces the zod contract on the
 *  client too (same schema module the server validates with). `fetching` is
 *  true while any (re-)fetch is in flight — screens with in-place URL nav
 *  (予約 date-nav) use it for the web-parity pending dim. */
export function useScreenDto<T>(path: string, parse: (raw: unknown) => T) {
  const [state, setState] = useState<State<T>>(() =>
    dtoCache.has(path)
      ? { status: 'ready', dto: dtoCache.get(path) as T, path }
      : { status: 'loading' },
  )
  const [attempt, setAttempt] = useState(0)
  const [fetching, setFetching] = useState(true)
  const retry = useCallback(() => {
    // An explicit retry after an error must never flash stale content on a
    // later revisit — drop this path's cache entry along with the state.
    dtoCache.delete(path)
    fetchedAtByPath.delete(path)
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [path])

  // router.refresh() (post-mutation, e.g. a new booking) → re-fetch WITHOUT
  // dropping to the loading frame: the current dto stays on screen and swaps
  // when the fresh one lands — the shell's analogue of Next's refresh keeping
  // stale content visible during the server re-render. An in-flight previous
  // fetch can't clobber: each effect run's `alive` flag dies on re-run.
  // Refresh events are rare (post-mutation, post-heal) and mean every other
  // mounted/cached screen may now be stale too — nuke the whole dto cache;
  // this mounted screen already re-fetches below, revisits after start fresh.
  useEffect(
    () =>
      subscribeRefresh(() => {
        dtoCache.clear()
        fetchedAtByPath.clear()
        setAttempt((n) => n + 1)
      }),
    [],
  )

  // Foreground revalidate (perf packet 29): a quiet re-check on app
  // foreground — unlike the refresh subscription above, this keeps the
  // cache and only re-fetches if THIS path is past STALE_MS. Bumping
  // `attempt` re-runs the fetch effect with state still 'ready' — the
  // current dto stays painted and swaps when the fresh one lands
  // (swap-not-flash, no new state machinery). Dep is [path] (the closure
  // reads it), unlike the refresh effect's [] — each mounted screen only
  // revalidates itself.
  useEffect(
    () =>
      subscribeRevalidate(() => {
        if (Date.now() - (fetchedAtByPath.get(path) ?? 0) > STALE_MS)
          setAttempt((n) => n + 1)
      }),
    [path],
  )

  useEffect(() => {
    let alive = true
    // Fix F2-3: the grace branch below parks a contentless screen on
    // `loading` with no retry button and nothing bumping `attempt` — set (and
    // cleared) only by the grace branch itself, so it can self-escape without
    // leaking a subscription past this effect's own lifetime.
    let unsubscribeGrace: (() => void) | undefined
    setFetching(true)
    // Straggler-write fence (audit find on the packet): a fetch still in
    // flight across a sign-out would settle AFTER the signed-out cache wipe
    // and re-populate the cache with the outgoing user's dto — the next
    // user's first frame on a shared iPad would paint it. Capture the auth
    // generation at fetch start; any authoritative transition (sign-out,
    // sign-in, boot result) advances it, so a cross-generation settle never
    // writes the cache. Same fence background-resume uses; same-user token
    // rotations stay within a generation and cache normally.
    const gen = currentGeneration()
    getDataPort()
      .apiFetch(path)
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          const message = (body as { error?: { message?: string } } | null)?.error
            ?.message
          throw new HttpError(res.status, message ?? `HTTP ${res.status}`)
        }
        return parse(body)
      })
      .then((dto) => {
        // Both gates, different windows (two blind lenses converged on this):
        // `alive` drops SAME-generation stragglers — a superseded fetch (nav
        // A→B→A, retry, refresh, and critically the store-lens self-heal,
        // none of which advance the auth generation) must not overwrite the
        // cache with older or wrong-store data. The generation fence drops
        // CROSS-generation stragglers in the microtask window before React
        // commits the sign-out unmount (alive can still be true there).
        if (alive && currentGeneration() === gen) cacheDto(path, dto)
        if (alive) setState({ status: 'ready', dto, path })
      })
      .catch((err: unknown) => {
        if (!alive) return
        // Fix F2: a seeded EXPIRED Bearer races the settle-refresh — first
        // fetches can 401 before the heal lands. Hold `loading` instead of
        // flashing the error card; the settle refresh (armSettleRefresh)
        // clears dtoCache and re-fetches once the token heals, hard-bounded
        // by the ≤4s boot-gate timeout (whose own recovering write clears
        // the flag same as any store write). Any OTHER failure, or a 401
        // outside this window, keeps today's exact semantics below.
        // The same-path-keeps-dto rule below still wins inside the window: a
        // screen already showing content must never drop to a blank loading
        // frame because a revalidate 401'd — only a contentless screen holds
        // `loading` here. `fetching` still flips false via .finally below
        // even while parked here — this branch is a transient (≤4s, F2-3
        // self-escape bounded) `loading` state, not a genuinely in-flight one.
        if (err instanceof HttpError && err.status === 401 && isSeedPendingVerification()) {
          setState((prev) =>
            prev.status === 'ready' && prev.path === path ? prev : { status: 'loading' },
          )
          // Fix F2-3 (P2, both lenses converged): a contentless screen parked
          // here has no retry button and nothing else bumps `attempt` — if
          // the settle brings the SAME token (F3: no emitRefresh) or recovery
          // stays 'recovering', it would be stranded until a tab switch.
          // Self-escape: a ONE-SHOT store-write listener bumps `attempt` on
          // the NEXT write — the boot gate GUARANTEES one ≤4s (a real settle,
          // or the timeout's own recovering echo), which re-runs this effect.
          // By then seedPendingVerification is already cleared (apply()
          // clears it on every write, this one included), so a still-401
          // refetch lands on the honest error card + retry below. Note: a
          // rotated-token settle can double-bump (this hook fires, and
          // armSettleRefresh's emitRefresh also clears dtoCache + bumps via
          // subscribeRefresh) — the second effect run supersedes the first
          // via `alive`, one visible result, accepted.
          unsubscribeGrace = subscribeSessionState(() => {
            if (!alive) return
            unsubscribeGrace?.()
            setAttempt((n) => n + 1)
          })
          return
        }
        // A failed re-fetch of the SAME path keeps the rendered dto — web
        // parity: a failed router.refresh() leaves the page intact (the
        // mutation's success toast must not be followed by an error frame).
        // A failed fetch for a NEW path errors honestly: keeping the old
        // path's content would silently show the wrong day/record.
        setState((prev) =>
          prev.status === 'ready' && prev.path === path
            ? prev
            : {
                status: 'error',
                message: err instanceof Error ? err.message : String(err),
              },
        )
      })
      .finally(() => {
        if (alive) setFetching(false)
      })
    return () => {
      alive = false
      // F2-3: unmounting (or re-running for a new attempt) before the grace
      // escape fires must drop the listener — no leak, no post-unmount setState.
      unsubscribeGrace?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- parse is a module-level schema fn; attempt drives retries
  }, [path, attempt])

  return { state, retry, fetching }
}

export function ScreenLoading() {
  const t = useTranslations('common')
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground">
      {t('loading')}
    </div>
  )
}

export function ScreenError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTranslations('common')
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-sm text-muted-foreground">{t('somethingWentWrong')}</p>
      <p className="max-w-xs break-all text-xs text-muted-foreground/70">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background"
      >
        {t('retry')}
      </button>
    </div>
  )
}

/** Render helper so every screen shares identical loading/error handling. */
export function ScreenStates<T>({
  state,
  retry,
  children,
}: {
  state: State<T>
  retry: () => void
  children: (dto: T) => ReactNode
}) {
  if (state.status === 'loading') return <ScreenLoading />
  if (state.status === 'error') return <ScreenError message={state.message} onRetry={retry} />
  return <>{children(state.dto)}</>
}
