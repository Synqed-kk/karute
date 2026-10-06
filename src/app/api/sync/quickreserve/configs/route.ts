import { NextResponse } from 'next/server'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { errorBody, toAppApiError } from '@/lib/app-api/errors'

// The 予約同期 all-stores list (S53 PR-C): one row per store with that store's
// Quick Reserve config. ⚖ Store isolation law: a caller without stores.viewAll
// must not learn that other stores exist, so this route answers them 403 and
// the screen never asks (hide, never show-and-refuse). A viewAll caller may
// edit every active store of the business, so every active store is a row.
// No secrets: never the password, never the login id — only the fields the
// table shows.

export type SyncStoreRow = {
  storeId: string
  storeName: string
  configured: boolean
  enabled: boolean
  qrStoreSlug: string | null
  qrStoreId: number | null
  lastRunStatus: 'OK' | 'ERROR' | 'RUNNING' | null
  lastRunAt: string | null
  lastRunError: string | null
  intervalMinutes: number | null
  hoursStart: number | null
  hoursEnd: number | null
}

export async function GET() {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const capabilities = await getMyCapabilities()
    ensureCapability(capabilities, 'sync.view')
    ensureCapability(capabilities, 'stores.viewAll')
  } catch (err) {
    const apiErr = toAppApiError(err)
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status })
  }

  try {
    const synqed = await getSynqedClient()
    const [{ stores }, configs] = await Promise.all([
      synqed.stores.list(),
      synqed.sync.listConfigs('QUICKRESERVE'),
    ])
    const rows: SyncStoreRow[] = stores
      .filter((s) => s.active !== false)
      .map((s) => {
        const c = configs.find((cfg) => cfg.karute_store_id === s.id)
        return {
          storeId: s.id,
          storeName: s.name,
          configured: Boolean(c),
          enabled: c?.enabled ?? false,
          qrStoreSlug: c?.store_slug ?? null,
          qrStoreId: c?.store_id ?? null,
          lastRunStatus: c?.last_run_status ?? null,
          lastRunAt: c?.last_run_at ?? null,
          lastRunError: c?.last_run_error ?? null,
          intervalMinutes: c?.interval_minutes ?? null,
          hoursStart: c?.business_hours_start ?? null,
          hoursEnd: c?.business_hours_end ?? null,
        }
      })
    return NextResponse.json({ stores: rows })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not read the stores' },
      { status: 502 },
    )
  }
}
