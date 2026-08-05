// Shared fetch-on-mount boundary for thin screens (packet 04 router seed).
// One tiny state machine — loading / error+retry / ready — so each screen
// wrapper is just "fetch DTO, validate, render view". No route-level data
// magic per the packet: screens fetch via the DataPort on mount.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { getDataPort } from '@/lib/ports/data-port'
import {
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

// Straggler fence for in-flight mount-fetch writes — bumped ONLY on
// sign-out (mirrors brief-cache.ts's sessionEpoch idiom exactly; that
// module hit this same trap first, Liam field bug 7/25 — see its comment
// for the full story). Deliberately NOT session-store's currentGeneration():
// that bumps on EVERY authoritative write, including a routine same-user
// cold-boot double-settle (boot recover + GoTrue INITIAL_SESSION landing on
// the SAME user) — a generation fence treated that routine echo as
// "different user" and silently discarded the mount fetch's cache write, so
// dtoCache/fetchedAtByPath never stamped on a mount fetch straddling boot
// churn: every revisit refetched, and foreground revalidate always saw
// stamp 0 (screens still painted correctly — `alive` alone guards setState —
// this was wasted network, not a correctness bug). The fence's real job is
// narrower: a fetch started under user A must never write user B's cache,
// and only a SIGN-OUT sits between any two users on a shared device.
let sessionEpoch = 0

/** Current sign-out epoch, for screen-prefetch.ts's timer bodies to capture
 *  at their own fetch start — they write into this same dtoCache and need
 *  the identical straggler fence. */
export function dtoSessionEpoch(): number {
  return sessionEpoch
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
    sessionEpoch++ // invalidate every in-flight mount fetch's settle (fence above)
    dtoCache.clear()
    fetchedAtByPath.clear()
  }
})

// Refresh-wipe fence (Fable audit find, races lens P2): the per-hook
// subscribeRefresh below does dtoCache.clear() + setAttempt SYNCHRONOUSLY on
// emitRefresh, but that's a React state update — the OLD effect's cleanup
// (the thing that flips `alive` false) only runs when React flushes the
// resulting passive-effect teardown/re-run, which is DEFERRED past the
// current tick. The stale fetch's own `.then()` chain is a microtask, which
// can settle BEFORE that deferred cleanup — `alive` reads true and the
// straggler re-populates the cache emitRefresh just cleared with
// pre-mutation data. `sessionEpoch` above doesn't help either: a refresh is
// not a sign-out. This is the exact class screen-prefetch.ts's wipeEpoch
// fence already closes for its own timers (bumped by its OWN subscribeRefresh
// listener, checked at settle) — mirrored here, but bumped by a MODULE-SCOPE
// listener (not the per-hook one below, which keeps doing the hard clear +
// attempt bump unchanged) so it closes the window for every mounted hook
// instance regardless of which one's cleanup is still pending.
let refreshEpoch = 0
subscribeRefresh(() => {
  refreshEpoch++
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
  // Ref twin of `fetching` for the revalidate subscriber below (Greptile
  // #596 P2): the subscription closure would capture a stale `fetching`
  // value; the ref always reads current. Written ONLY beside setFetching.
  const fetchingRef = useRef(true)
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
  // In-flight dedup (Greptile #596 P2): the stamp lands only on SUCCESS, so
  // a second foreground during a still-running revalidate would read the
  // same stale stamp and fire a duplicate fetch (superseding the first via
  // `alive` — correct but wasted). Any in-flight fetch for this hook's path
  // (mount, refresh, retry, a previous revalidate) suppresses the bump; on
  // settle `fetching` flips false and the NEXT foreground re-checks
  // staleness, so a failed revalidate still self-heals.
  useEffect(
    () =>
      subscribeRevalidate(() => {
        if (
          !fetchingRef.current &&
          Date.now() - (fetchedAtByPath.get(path) ?? 0) > STALE_MS
        )
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
    fetchingRef.current = true
    // Straggler-write fence (Liam field bug 7/25, same root cause brief-
    // cache.ts hit first — see sessionEpoch's declaration comment above for
    // the full story). Capture this module's sign-out epoch at fetch start;
    // only a sign-out bumps it, so a cross-user settle never writes the
    // cache. Deliberately NOT currentGeneration(): a same-user cold-boot
    // double-settle bumps that too, and used to discard this write for no
    // reason — a pure efficiency bug (dtoCache/fetchedAtByPath never
    // stamped, so every revisit and every foreground revalidate refetched),
    // never a correctness one (the `alive` guard below already keeps
    // setState honest regardless).
    const epoch = sessionEpoch
    // Refresh-wipe fence (see refreshEpoch's declaration comment above):
    // captured the same way, alongside the sign-out epoch.
    const myRefreshEpoch = refreshEpoch
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
        // THREE gates, three different windows — `alive` is NOT enough on
        // its own (Fable audit find): it only closes the race EVENTUALLY,
        // once React flushes the old effect's cleanup. That flush is a
        // deferred passive-effect teardown, while this `.then()` is a
        // microtask — a stale fetch can settle with `alive` still true in
        // the window before cleanup runs. So:
        // - `alive` drops SAME-epoch stragglers once superseded (nav A→B→A,
        //   retry, a later revalidate, the store-lens self-heal) — none of
        //   these bump either epoch below, and none need a faster gate: they
        //   aren't racing a synchronous wipe. A same-user boot double-settle
        //   supersedes NOTHING (no effect re-run in the same-token case) —
        //   its straddled write lands, which is this fence's whole point.
        // - `sessionEpoch` drops CROSS-user stragglers: bumped synchronously
        //   by the module-scope sign-out subscriber above, so it closes the
        //   microtask window `alive` alone can't, before React ever commits
        //   the sign-out unmount.
        // - `refreshEpoch` drops post-mutation stragglers the same way: a
        //   fetch in flight when emitRefresh() clears dtoCache must not
        //   repopulate it with pre-mutation data, and `alive` alone races
        //   that clear too (same deferred-cleanup-vs-microtask gap). Mirrors
        //   screen-prefetch.ts's wipeEpoch fence for its own timers exactly.
        if (alive && sessionEpoch === epoch && refreshEpoch === myRefreshEpoch)
          cacheDto(path, dto)
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
        // `alive` guard on the ref too: a superseded run's settle must not
        // mark the NEWER run's in-flight fetch as done.
        if (alive) {
          setFetching(false)
          fetchingRef.current = false
        }
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
        className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary-hover"
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
