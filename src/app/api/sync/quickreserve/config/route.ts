import { NextResponse } from 'next/server'
import { auditWeb } from '@/lib/audit-web'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { errorBody, toAppApiError } from '@/lib/app-api/errors'
import { resolveStoreScope } from '@/lib/auth/store-scope'
import { qrConfigForStore } from '@/lib/sync/qr-config'

// QuickReserve connection settings live in synqed-core (sync_configs; the
// credentials are AES-encrypted server-side and never leave core). This route
// is a thin proxy over the SDK's sync namespace. getBusinessId() is the auth
// gate (401, no session); sync.view is the capability gate (403) — same
// posture as the sibling /api/sync/quickreserve run-now route (PR-M2 fix
// round). Before this fix ANY signed-in staff could read the QR username
// (GET) or rewrite credentials / flip enabled (POST), which core's 15-min
// cron then replays. GET emits no audit row — config-read classification is
// a Wave M4 decision-table item, not preempted here. POST's write audit
// (below) is unchanged.

export async function GET() {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    ensureCapability(await getMyCapabilities(), 'sync.view')
  } catch (err) {
    const apiErr = toAppApiError(err)
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status })
  }

  // The ACTIVE store's own row (CORE-43: one config per store). A store with
  // no row yet reads as unconfigured; qrStoreSlug pre-fills the Quick Reserve
  // account slug from a sibling store's row (one owner login, several stores).
  const synqed = await getSynqedClient()
  const { storeId } = await resolveStoreScope()
  const { config, configs } = storeId
    ? await qrConfigForStore(synqed, storeId)
    : { config: null, configs: [] }
  if (!config) {
    return NextResponse.json({
      username: '',
      enabled: false,
      lastStatus: null,
      configured: false,
      qrStoreSlug: configs.find((c) => c.store_slug)?.store_slug ?? '',
    })
  }

  return NextResponse.json({
    username: config.username ?? '',
    enabled: config.enabled,
    configured: true,
    lastStatus: config.last_run_status
      ? `${config.last_run_status}${config.last_run_error ? ': ' + config.last_run_error : ''}`
      : null,
    // Raw ISO instant — the client formats it, so it renders in the DEVICE's
    // timezone/locale. Formatting here ran in the lambda's zone: UTC-rendered
    // en-US dates on JST phones.
    lastRunAt: config.last_run_at ?? null,
  })
}

export async function POST(request: Request) {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    ensureCapability(await getMyCapabilities(), 'sync.view')
  } catch (err) {
    const apiErr = toAppApiError(err)
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status })
  }

  const { username, password, enabled, qrStoreSlug, qrStoreId } = await request.json()
  const synqed = await getSynqedClient()
  // Which store's row this save changed — for the audit row below.
  let savedStoreId: string | null = null

  // CORE-43: each Karute store saves ITS OWN row (core keys configs by
  // business + provider + karute_store_id), so a 銀座 save can never rebind
  // 代官山's live crawl. A store's first save must also name its Quick
  // Reserve store (slug + numeric id); core refuses a QR store another row
  // already crawls (qr_store_already_linked).
  //
  // The guard's own reads share the write's error boundary: a core outage or
  // a scope-lookup failure returns the 502 shape the screen already shows.
  try {
    const { storeId } = await resolveStoreScope()
    if (!storeId) {
      return NextResponse.json(
        {
          error: 'qr_store_not_ready',
          // Dev/log-facing only — the settings UI shows its own localized
          // copy (settings.bookingSyncStoreNotReady) keyed off the code.
          message: 'No store is selected for this Quick Reserve config.',
        },
        { status: 409 },
      )
    }
    const { config: existing } = await qrConfigForStore(synqed, storeId)

    const slug = typeof qrStoreSlug === 'string' ? qrStoreSlug.trim() : ''
    const qrId = Number(qrStoreId)
    const login = typeof username === 'string' ? username.trim() : ''
    if (!existing && (!slug || !Number.isInteger(qrId) || qrId <= 0 || !login || !password)) {
      return NextResponse.json(
        { error: 'qr_store_required', message: 'A new store needs its Quick Reserve store and login.' },
        { status: 400 },
      )
    }

    await synqed.sync.upsertConfig('QUICKRESERVE', {
      username,
      // Only send the password when the owner typed one — core keeps the stored
      // credential otherwise (the field renders blank on load by design).
      ...(password ? { password } : {}),
      enabled,
      // An existing row keeps its own Quick Reserve store (代官山: la-estro/222);
      // a new row takes the one the owner entered.
      ...(existing
        ? {
            ...(existing.store_slug ? { store_slug: existing.store_slug } : {}),
            ...(existing.store_id ? { store_id: existing.store_id } : {}),
          }
        : { store_slug: slug, store_id: qrId }),
      karute_store_id: storeId,
    })
    savedStoreId = storeId
  } catch (e) {
    // Surface the real failure — whether it came from a read above or the
    // write itself (the old route's "Config saved" false positive).
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not save QuickReserve settings' },
      { status: 502 },
    )
  }

  // Credential-bearing config write; flags only, never the values.
  await auditWeb({
    category: 'settings',
    action: 'settings.sync_config_update',
    severity: 'notice',
    targetType: 'business',
    requestId: crypto.randomUUID(),
    detail: {
      enabled: Boolean(enabled),
      password_changed: Boolean(password),
      karute_store_id: savedStoreId,
    },
  })

  return NextResponse.json({ success: true })
}
