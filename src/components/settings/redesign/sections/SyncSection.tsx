'use client'

import { getDataPort } from '@/lib/ports/data-port'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { CheckCircle2, AlertCircle } from 'lucide-react'

type SyncResponse = {
  error?: string | { code?: string; message?: string }
  message?: string
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

export function SyncSection() {
  const t = useTranslations('settings')
  const tAuth = useTranslations('auth')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<string | null>(null)

  useEffect(() => {
    getDataPort().apiFetch('/api/sync/quickreserve/config')
      .then((r) => r.json())
      .then((data) => {
        if (data.username) setUsername(data.username)
        if (data.enabled !== undefined) setEnabled(data.enabled)
        if (data.lastStatus)
          setLastResult(
            data.lastRunAt
              ? `${data.lastStatus} (${new Date(data.lastRunAt).toLocaleString()})`
              : data.lastStatus,
          )
      })
      .catch(() => {})
  }, [])

  async function saveConfig() {
    setSyncing(true)
    try {
      const res = await getDataPort().apiFetch('/api/sync/quickreserve/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, enabled }),
      })
      const parsed = await readSyncResponse(res)
      setLastResult(parsed.ok ? 'Config saved' : parsed.message)
    } catch {
      setLastResult('Failed to save')
    }
    setSyncing(false)
  }

  async function syncNow() {
    setSyncing(true)
    setLastResult('Syncing...')
    try {
      const res = await getDataPort().apiFetch('/api/sync/quickreserve', { method: 'POST' })
      const parsed = await readSyncResponse(res)
      if (!parsed.ok) {
        setLastResult(parsed.message)
      } else {
        const d = parsed.data
        setLastResult(
          d.message ??
            `Synced: ${d.created ?? 0} created, ${d.updated ?? 0} updated, ${d.skipped ?? 0} skipped`,
        )
      }
    } catch (err) {
      setLastResult(
        `Failed: ${err instanceof Error ? err.message : 'Unknown'}`,
      )
    }
    setSyncing(false)
  }

  const isError =
    lastResult?.startsWith('Error') || lastResult?.startsWith('Failed')

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
          disabled={syncing}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
          <span>{lastResult}</span>
        </div>
      )}
    </div>
  )
}
