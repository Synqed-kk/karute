'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { SyncAllStoresList } from './SyncAllStoresList'
import { readSyncResponse } from '@/lib/sync/read-sync-response'
import * as syncInFlight from '@/lib/sync/in-flight'

// Re-exported: the reader moved to src/lib/sync/read-sync-response.ts.
export { readSyncResponse }

type ConfigResponse = {
  username?: string
  enabled?: boolean
  configured?: boolean
  qrStoreSlug?: string
  lastStatus?: string | null
  lastRunAt?: string | null
  lastRunStatus?: string | null
}

const SYNC_ERROR_COPY = {
  qr_store_not_ready: 'bookingSyncStoreNotReady',
  qr_store_unavailable: 'bookingSyncStoreUnavailable',
  store_not_in_business: 'bookingSyncStoreUnavailable',
  qr_store_required: 'bookingSyncQrStoreRequired',
  qr_store_already_linked: 'bookingSyncQrStoreAlreadyLinked',
  qr_password_required: 'bookingSyncPasswordRequired',
} as const

/** `storeId` = the active store the page was rendered for. The store
 *  switcher (setActiveStore + router.refresh) re-renders this section with a
 *  new one while its state lives on — so the form reloads per store and never
 *  carries the previous store's values. Every request (load · save · run)
 *  names this store explicitly; the server never acts on the cookie. */
/** `showAllStores` = the caller holds stores.viewAll; only then does the
 *  all-stores list render above the form (⚖ store isolation law). */
export function SyncSection({
  storeId = null,
  showAllStores = false,
  selectStore,
}: {
  storeId?: string | null
  showAllStores?: boolean
  selectStore?: (storeId: string) => Promise<{ ok: true } | { error: string }>
} = {}) {
  const t = useTranslations('settings')
  const tAuth = useTranslations('auth')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  // The login as loaded: a changed login needs its password too.
  const [loadedUsername, setLoadedUsername] = useState('')
  const [enabled, setEnabled] = useState(false)
  // CORE-43: a store with no config yet names its own Quick Reserve store.
  const [configured, setConfigured] = useState(true)
  const [qrStoreSlug, setQrStoreSlug] = useState('')
  const [qrStoreId, setQrStoreId] = useState('')
  // EVERY store with a save or run in flight ('' = no store shown), so a
  // request for one store never disables another store's form, and a store
  // whose own request is still pending stays marked after a switch away and
  // back. The set is the page's one in-flight set (src/lib/sync/in-flight.ts),
  // so it also survives leaving the tab; each request removes only its own store.
  const inFlight = useSyncExternalStore(syncInFlight.subscribe, syncInFlight.snapshot, syncInFlight.snapshot)
  const [lastResult, setLastResult] = useState<{ text: string; error: boolean } | null>(null)
  // The store whose config is loaded (undefined = loading, or the load
  // failed). Save stays off until it is the shown store, so a blank or reset
  // form can never be posted over a live row.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  // The store shown NOW: a save or run answer for another store is dropped.
  const shownStore = useRef(storeId)
  // Which config load is the latest: each load captures its own number, and
  // its answer applies only while it is still the latest (and its store is
  // still shown). A successful save bumps it too, so a load sent before the
  // save answered can never put the old login back (fix round 8, attack A-6).
  const loadGeneration = useRef(0)
  // Bumped when a store's sync config changed through this form (a save that
  // succeeded, a 今すぐ同期 that answered): the all-stores list reloads on it.
  const [listGeneration, setListGeneration] = useState(0)

  useEffect(() => {
    // Reset BEFORE the load, and drop a late answer for a store no longer
    // selected, so another store's values can never reach this store's Save.
    shownStore.current = storeId
    const generation = ++loadGeneration.current
    let current = true // false once this effect is cleaned up (switch · unmount)
    const latest = () => current && generation === loadGeneration.current && shownStore.current === storeId
    setLoadedFor(undefined)
    setUsername('')
    setLoadedUsername('')
    setPassword('')
    setEnabled(false)
    setConfigured(true)
    setQrStoreSlug('')
    setQrStoreId('')
    setLastResult(null)
    getDataPort().apiFetch(
      `/api/sync/quickreserve/config${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ''}`,
    )
      .then(async (r) => {
        const parsed = await readSyncResponse(r)
        if (!latest()) return
        if (!parsed.ok) {
          setLastResult({ text: failureLine(parsed.message), error: true }) // the surface's error line; Save stays off
          return
        }
        const data = parsed.data as unknown as ConfigResponse
        if (data.username) setUsername(data.username)
        setLoadedUsername(data.username ?? '')
        if (data.enabled !== undefined) setEnabled(data.enabled)
        if (data.configured === false) {
          setConfigured(false)
          setQrStoreSlug(data.qrStoreSlug ?? '')
        }
        if (data.lastStatus)
          setLastResult({
            text: data.lastRunAt
              ? `${data.lastStatus} (${new Date(data.lastRunAt).toLocaleString()})`
              : data.lastStatus,
            // The run's own status — never the case of a free-text prefix.
            error: data.lastRunStatus === 'ERROR',
          })
        setLoadedFor(storeId)
      })
      .catch(() => {
        if (latest()) setLastResult({ text: t('bookingSyncUnavailable'), error: true })
      })
    return () => {
      current = false
    }
  }, [storeId])

  // A refusal's stable code shows OUR localized line, following the language
  // toggle; anything else (a 5xx, an unknown error) shows ONE generic line.
  // The raw cause stays in the response body for devtools and the audit.
  function failureLine(message: string): string {
    const detail = /^Error \(\d+\): ([\s\S]*)$/.exec(message)?.[1] ?? ''
    return Object.prototype.hasOwnProperty.call(SYNC_ERROR_COPY, detail)
      ? t(SYNC_ERROR_COPY[detail as keyof typeof SYNC_ERROR_COPY])
      : t('bookingSyncUnavailable')
  }

  function beginSyncing(key: string) {
    syncInFlight.claim(key)
  }
  // Removes only this request's store, never another store's (a store switch
  // does not cancel the old request; its late answer is dropped by the
  // shownStore guard).
  function endSyncing(key: string) {
    syncInFlight.release(key)
  }

  // The all-stores list's row runs and すべての店舗を同期 share THIS set, so the
  // form and the list never crawl one store twice at once: a claim is refused
  // (false) while the store is already in flight here or in the list.
  function claimSyncing(key: string) {
    return syncInFlight.claim(key)
  }

  // Both actions capture the store at request time and ignore an answer that
  // lands after the form moved to another store.
  async function saveConfig() {
    const forStore = storeId
    const key = forStore ?? ''
    // What this save sends, so its answer can show exactly what was saved.
    const savedLogin = username.trim()
    const savedEnabled = enabled
    beginSyncing(key)
    try {
      const res = await getDataPort().apiFetch('/api/sync/quickreserve/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(storeId ? { storeId } : {}),
          username,
          password,
          enabled,
          ...(configured ? {} : { qrStoreSlug, qrStoreId }),
        }),
      })
      const parsed = await readSyncResponse(res)
      if (parsed.ok) setListGeneration((g) => g + 1)
      if (shownStore.current !== forStore) return
      if (parsed.ok) {
        // The saved values are now the store's row: any load sent before this
        // answer is stale, and the form shows what was saved. A blank login
        // keeps the stored one (the route never blanks it), so it is left as is.
        loadGeneration.current++
        setConfigured(true)
        setEnabled(savedEnabled)
        if (savedLogin) {
          setUsername(savedLogin)
          setLoadedUsername(savedLogin)
        }
        setLoadedFor(forStore)
      }
      setLastResult(
        parsed.ok
          ? { text: t('syncSection.configSaved'), error: false }
          : { text: failureLine(parsed.message), error: true },
      )
    } catch {
      if (shownStore.current === forStore) setLastResult({ text: t('bookingSyncUnavailable'), error: true })
    } finally {
      endSyncing(key)
    }
  }

  async function syncNow() {
    const forStore = storeId
    const key = forStore ?? ''
    beginSyncing(key)
    setLastResult({ text: t('syncing'), error: false })
    try {
      const res = await getDataPort().apiFetch('/api/sync/quickreserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeId ? { storeId } : {}),
      })
      const parsed = await readSyncResponse(res)
      setListGeneration((g) => g + 1)
      if (shownStore.current !== forStore) return
      if (!parsed.ok) {
        setLastResult({ text: failureLine(parsed.message), error: true })
      } else {
        const d = parsed.data
        setLastResult({
          text:
            d.code === 'not_configured'
              ? t('bookingSyncNotConfigured')
              : t('syncSection.result', { created: d.created ?? 0, updated: d.updated ?? 0, skipped: d.skipped ?? 0 }),
          error: false,
        })
      }
    } catch {
      if (shownStore.current !== forStore) return
      setLastResult({ text: t('bookingSyncUnavailable'), error: true })
    } finally {
      endSyncing(key)
    }
  }

  const isError = lastResult?.error === true
  // Disabled only while THIS store's own save or run is in flight.
  const syncing = inFlight.has(storeId ?? '')
  // Core keeps the OLD credentials when only the login changes, so a changed
  // login needs its password too (fix round 4, Opus C3; the route mirrors it).
  const loginNeedsPassword =
    configured && username.trim() !== '' && username.trim() !== loadedUsername.trim() && !password

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('bookingSync')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('bookingSyncDescription')}
        </p>
      </div>

      {showAllStores && selectStore && (
        <SyncAllStoresList selectStore={selectStore} inFlight={inFlight} beginSyncing={claimSyncing} endSyncing={endSyncing} listGeneration={listGeneration} />
      )}

      <div>
        <label className="text-sm font-medium mb-1.5 block">
          {t('provider')}
        </label>
        <select
          value="quickreserve"
          disabled
          className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm appearance-none disabled:opacity-80"
        >
          <option value="quickreserve">Quick Reserve</option>
          <option value="salon_board" disabled>
            Salon Board ({t('comingSoon')})
          </option>
          <option value="hot_pepper" disabled>
            HOT PEPPER Beauty ({t('comingSoon')})
          </option>
        </select>
        <p className="text-xs text-muted-foreground mt-1.5">
          {t('providerLockedNote')}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {t('loginId')}
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={syncing}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('loginIdPlaceholder')}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">
            {tAuth('password')}
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="••••••••"
          />
        </div>
      </div>

      {loginNeedsPassword && (
        <p className="text-xs text-muted-foreground">{t('bookingSyncPasswordRequired')}</p>
      )}

      {!configured && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('qrStoreSlug')}</label>
            <input
              type="text"
              value={qrStoreSlug}
              onChange={(e) => setQrStoreSlug(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="la-estro"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t('qrStoreId')}</label>
            <input
              type="text"
              inputMode="numeric"
              value={qrStoreId}
              onChange={(e) => setQrStoreId(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="250"
            />
          </div>
          <p className="text-xs text-muted-foreground md:col-span-2">{t('qrStoreHint')}</p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">{t('autoSyncTitle')}</h4>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('autoSyncDescription')}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('autoSyncTitle')}
          onClick={() => setEnabled(!enabled)}
          disabled={syncing}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? 'bg-primary' : 'bg-muted'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={saveConfig}
          disabled={syncing || !storeId || loadedFor !== storeId || loginNeedsPassword}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {t('saveConfig')}
        </button>
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          {syncing ? t('syncing') : t('syncNow')}
        </button>
      </div>

      {lastResult && (
        <div
          className={`flex items-start gap-2 rounded-lg px-4 py-3 text-sm border ${
            isError
              ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
          }`}
        >
          {isError ? (
            <AlertCircle className="size-4 shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="size-4 shrink-0 mt-0.5" />
          )}
          <span>{lastResult.text}</span>
        </div>
      )}
    </div>
  )
}
