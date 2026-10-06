'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertCircle } from 'lucide-react'

type SyncResponse = {
  error?: string | { code?: string; message?: string }
  message?: string
  code?: string
  created?: number
  updated?: number
  skipped?: number
}

/**
 * Read a sync API response defensively. On a HANDLED failure the route returns
 * clean JSON ({ error }); but on a platform CRASH/timeout Vercel returns PLAIN
 * TEXT ("Internal Server Error") — calling res.json() on that threw
 * "Unexpected token 'I'" and masked the real failure. So: read text first, parse
 * if we can, and ALWAYS surface the HTTP status so the true error is visible.
 */
export async function readSyncResponse(
  res: Response,
): Promise<{ ok: true; data: SyncResponse } | { ok: false; message: string }> {
  const raw = await res.text().catch(() => '')
  let data: SyncResponse | null = null
  try {
    data = raw ? (JSON.parse(raw) as SyncResponse) : null
  } catch {
    /* non-JSON body (e.g. Vercel's plain "Internal Server Error" on a crash) */
  }
  if (!res.ok || data?.error) {
    // The 403 body nests the message ({error:{code,message}}); older/other
    // failures still send error as a plain string — prefer the object's
    // message when present.
    const err = data?.error
    const detail =
      (typeof err === 'object' && err !== null ? err.message : err) ??
      (raw ? raw.slice(0, 160) : res.statusText)
    return { ok: false, message: `Error (${res.status}): ${detail}` }
  }
  return { ok: true, data: data ?? {} }
}

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
} as const

/** `storeId` = the active store the page was rendered for. The store
 *  switcher (setActiveStore + router.refresh) re-renders this section with a
 *  new one while its state lives on — so the form reloads per store and never
 *  carries the previous store's values. Every request (load · save · run)
 *  names this store explicitly; the server never acts on the cookie. */
export function SyncSection({ storeId = null }: { storeId?: string | null } = {}) {
  const t = useTranslations('settings')
  const tAuth = useTranslations('auth')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(false)
  // CORE-43: a store with no config yet names its own Quick Reserve store.
  const [configured, setConfigured] = useState(true)
  const [qrStoreSlug, setQrStoreSlug] = useState('')
  const [qrStoreId, setQrStoreId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<{ text: string; error: boolean } | null>(null)
  // The store whose config is loaded (undefined = loading, or the load
  // failed). Save stays off until it is the shown store, so a blank or reset
  // form can never be posted over a live row.
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  // The store shown NOW: a save or run answer for another store is dropped.
  const shownStore = useRef(storeId)

  useEffect(() => {
    // Reset BEFORE the load, and drop a late answer for a store no longer
    // selected, so another store's values can never reach this store's Save.
    shownStore.current = storeId
    let current = true
    setLoadedFor(undefined)
    setUsername('')
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
        if (!current) return
        if (!parsed.ok) {
          setLastResult({ text: failureLine(parsed.message), error: true }) // the surface's error line; Save stays off
          return
        }
        const data = parsed.data as unknown as ConfigResponse
        if (data.username) setUsername(data.username)
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
        if (current) setLastResult({ text: t('bookingSyncUnavailable'), error: true })
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

  // Both actions capture the store at request time and ignore an answer that
  // lands after the form moved to another store.
  async function saveConfig() {
    const forStore = storeId
    setSyncing(true)
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
      if (shownStore.current !== forStore) return
      if (parsed.ok) setConfigured(true)
      setLastResult(
        parsed.ok
          ? { text: t('syncSection.configSaved'), error: false }
          : { text: failureLine(parsed.message), error: true },
      )
    } catch {
      if (shownStore.current === forStore) setLastResult({ text: t('bookingSyncUnavailable'), error: true })
    } finally {
      setSyncing(false)
    }
  }

  async function syncNow() {
    const forStore = storeId
    setSyncing(true)
    setLastResult({ text: t('syncing'), error: false })
    try {
      const res = await getDataPort().apiFetch('/api/sync/quickreserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storeId ? { storeId } : {}),
      })
      const parsed = await readSyncResponse(res)
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
      setSyncing(false)
    }
  }

  const isError = lastResult?.error === true

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">{t('bookingSync')}</h3>
        <p className="text-sm text-muted-foreground">
          {t('bookingSyncDescription')}
        </p>
      </div>

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
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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
          disabled={syncing || !storeId || loadedFor !== storeId}
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
