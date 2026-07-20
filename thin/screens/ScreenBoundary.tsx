// Shared fetch-on-mount boundary for thin screens (packet 04 router seed).
// One tiny state machine — loading / error+retry / ready — so each screen
// wrapper is just "fetch DTO, validate, render view". No route-level data
// magic per the packet: screens fetch via the DataPort on mount.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { getDataPort } from '@/lib/ports/data-port'
import { subscribeRefresh } from '../ports/nav.vite'

type State<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  // `path` = the URL this dto belongs to, so a failed SAME-path re-fetch can
  // keep it while a failed fetch for a NEW path still errors honestly.
  | { status: 'ready'; dto: T; path: string }

/** Fetch a facade screen DTO on mount; parse enforces the zod contract on the
 *  client too (same schema module the server validates with). `fetching` is
 *  true while any (re-)fetch is in flight — screens with in-place URL nav
 *  (予約 date-nav) use it for the web-parity pending dim. */
export function useScreenDto<T>(path: string, parse: (raw: unknown) => T) {
  const [state, setState] = useState<State<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [fetching, setFetching] = useState(true)
  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  // router.refresh() (post-mutation, e.g. a new booking) → re-fetch WITHOUT
  // dropping to the loading frame: the current dto stays on screen and swaps
  // when the fresh one lands — the shell's analogue of Next's refresh keeping
  // stale content visible during the server re-render. An in-flight previous
  // fetch can't clobber: each effect run's `alive` flag dies on re-run.
  useEffect(() => subscribeRefresh(() => setAttempt((n) => n + 1)), [])

  useEffect(() => {
    let alive = true
    setFetching(true)
    getDataPort()
      .apiFetch(path)
      .then(async (res) => {
        const body: unknown = await res.json().catch(() => null)
        if (!res.ok) {
          const message = (body as { error?: { message?: string } } | null)?.error
            ?.message
          throw new Error(message ?? `HTTP ${res.status}`)
        }
        return parse(body)
      })
      .then((dto) => {
        if (alive) setState({ status: 'ready', dto, path })
      })
      .catch((err: unknown) => {
        if (!alive) return
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
