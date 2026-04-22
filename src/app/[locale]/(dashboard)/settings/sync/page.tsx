'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrg } from '@/components/providers/org-provider'
import { cn } from '@/lib/utils'
import type { SyncConfig, SyncRunResult } from '@synqed/client'

const PROVIDER = 'QUICKRESERVE' as const

interface FormState {
  username: string
  password: string
  store_slug: string
  store_id: string
  enabled: boolean
  interval_minutes: number
  business_hours_start: number
  business_hours_end: number
  lookahead_days: number
}

const defaultForm: FormState = {
  username: '',
  password: '',
  store_slug: 'la-estro',
  store_id: '222',
  enabled: false,
  interval_minutes: 15,
  business_hours_start: 8,
  business_hours_end: 22,
  lookahead_days: 7,
}

export default function SyncSettingsPage() {
  const { org } = useOrg()
  const [config, setConfig] = useState<SyncConfig | null>(null)
  const [form, setForm] = useState<FormState>(defaultForm)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [lastRunResult, setLastRunResult] = useState<SyncRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sync/${PROVIDER.toLowerCase()}/config?orgId=${org.id}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const data = (await res.json()) as SyncConfig | null
      setConfig(data)
      if (data) {
        setForm({
          username: data.username ?? '',
          password: '',
          store_slug: data.store_slug ?? 'la-estro',
          store_id: data.store_id != null ? String(data.store_id) : '222',
          enabled: data.enabled,
          interval_minutes: data.interval_minutes,
          business_hours_start: data.business_hours_start,
          business_hours_end: data.business_hours_end,
          lookahead_days: data.lookahead_days,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Load failed')
    } finally {
      setLoading(false)
    }
  }, [org.id])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        orgId: org.id,
        username: form.username,
        store_slug: form.store_slug,
        store_id: Number(form.store_id),
        enabled: form.enabled,
        interval_minutes: form.interval_minutes,
        business_hours_start: form.business_hours_start,
        business_hours_end: form.business_hours_end,
        lookahead_days: form.lookahead_days,
      }
      if (form.password) body.password = form.password

      const res = await fetch(`/api/sync/${PROVIDER.toLowerCase()}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      const updated = (await res.json()) as SyncConfig
      setConfig(updated)
      setForm((f) => ({ ...f, password: '' })) // clear the password field after save
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleRunNow = async () => {
    setRunning(true)
    setError(null)
    setLastRunResult(null)
    try {
      const res = await fetch(`/api/sync/${PROVIDER.toLowerCase()}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: org.id }),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      const result = (await res.json()) as SyncRunResult
      setLastRunResult(result)
      void loadConfig()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setRunning(false)
    }
  }

  const statusBadge = (() => {
    if (!config?.last_run_status) {
      return <span className="text-sm text-muted-foreground">Never run</span>
    }
    if (config.last_run_status === 'OK') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle2 className="size-4" /> OK
        </span>
      )
    }
    if (config.last_run_status === 'RUNNING') {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm text-blue-600">
          <Loader2 className="size-4 animate-spin" /> Running
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-red-600">
        <XCircle className="size-4" /> Error
      </span>
    )
  })()

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reservation sync</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pull bookings from Quick Reserve into your karute automatically.
        </p>
      </div>

      {error && (
        <Card className="border-red-300">
          <CardContent className="flex items-start gap-2 pt-6 text-sm text-red-700">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Quick Reserve</CardTitle>
          <CardDescription>Credentials and scheduling for the skim worker.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Username">
              <Input
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="QR login id"
              />
            </Field>
            <Field
              label="Password"
              hint={config?.has_credentials ? 'Leave blank to keep existing password' : 'Required'}
            >
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder={config?.has_credentials ? '••••••••' : 'QR password'}
              />
            </Field>
            <Field label="Store slug">
              <Input
                value={form.store_slug}
                onChange={(e) => setForm((f) => ({ ...f, store_slug: e.target.value }))}
                placeholder="la-estro"
              />
            </Field>
            <Field label="Store ID">
              <Input
                type="number"
                value={form.store_id}
                onChange={(e) => setForm((f) => ({ ...f, store_id: e.target.value }))}
                placeholder="222"
              />
            </Field>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Frequency">
              <Select
                value={String(form.interval_minutes)}
                onValueChange={(v) => setForm((f) => ({ ...f, interval_minutes: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">Every 15 min</SelectItem>
                  <SelectItem value="30">Every 30 min</SelectItem>
                  <SelectItem value="60">Hourly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Business hours start">
              <Select
                value={String(form.business_hours_start)}
                onValueChange={(v) => setForm((f) => ({ ...f, business_hours_start: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, '0')}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Business hours end">
              <Select
                value={String(form.business_hours_end)}
                onValueChange={(v) => setForm((f) => ({ ...f, business_hours_end: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <SelectItem key={h} value={String(h + 1)}>
                      {String(h + 1).padStart(2, '0')}:00
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Lookahead" hint="Days of future bookings to sync">
              <Input
                type="number"
                min={0}
                max={30}
                value={form.lookahead_days}
                onChange={(e) => setForm((f) => ({ ...f, lookahead_days: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Status">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                Enable automatic sync
              </label>
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              Save
            </Button>
            <Button
              variant="outline"
              onClick={handleRunNow}
              disabled={running || !config?.has_credentials}
            >
              {running ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1.5 size-4" />
              )}
              Sync now
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>Last run outcome and stats.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Row label="Status">{statusBadge}</Row>
          <Row label="Last run at">
            {config?.last_run_at ? new Date(config.last_run_at).toLocaleString() : '—'}
          </Row>
          {config?.last_run_error && (
            <Row label="Error">
              <span className="text-red-700">{config.last_run_error}</span>
            </Row>
          )}
          {lastRunResult && (
            <div className="mt-2 rounded-md bg-muted/50 p-3 font-mono text-xs">
              <div>Fetched: {lastRunResult.total_fetched}</div>
              <div>Created: {lastRunResult.created}</div>
              <div>Updated: {lastRunResult.updated}</div>
              <div>Cancelled: {lastRunResult.cancelled}</div>
              <div>Skipped (no staff match): {lastRunResult.skipped_no_staff}</div>
              <div>Skipped (deleted): {lastRunResult.skipped_deleted}</div>
              {lastRunResult.unmatched_staff.length > 0 && (
                <div className="mt-1 text-amber-700">
                  Unmatched staff: {lastRunResult.unmatched_staff.join(', ')}
                </div>
              )}
              <div className="mt-1 text-muted-foreground">
                Window: {new Date(lastRunResult.date_window.start).toLocaleDateString()} –{' '}
                {new Date(lastRunResult.date_window.end).toLocaleDateString()} ·{' '}
                {lastRunResult.duration_ms}ms
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium text-foreground">{label}</div>
      {children}
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Separator() {
  return <div className={cn('h-px w-full bg-border')} />
}
