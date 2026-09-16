import { NextResponse } from 'next/server'
import { auditWeb } from '@/lib/audit-web'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { errorBody, toAppApiError } from '@/lib/app-api/errors'
import { resolveStoreScope } from '@/lib/auth/store-scope'

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

  const synqed = await getSynqedClient()
  const config = await synqed.sync.getConfig('QUICKRESERVE')
  if (!config) {
    return NextResponse.json({ username: '', enabled: false, lastStatus: null })
  }

  return NextResponse.json({
    username: config.username ?? '',
    enabled: config.enabled,
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

  const { username, password, enabled } = await request.json()
  const synqed = await getSynqedClient()

  // Save guard (PKT-P0): core keeps ONE QuickReserve config per business, and
  // the old code always stamped it with La Estro's store_slug/store_id. A
  // 銀座 manager (or a brand-new company's owner) saving here would silently
  // rebind — or misfile — 代官山's live crawl. Per-store crawling is ordered
  // from core; until it lands, refuse rather than misfile.
  const existing = await synqed.sync.getConfig('QUICKRESERVE')
  const { storeId } = await resolveStoreScope()

  // existing config: only the store it's already labeled for may resave it —
  // a legacy row with no karute_store_id label is unproven, so it fails
  // closed (refused for EVERY actor, not just a mismatched one) rather than
  // being silently adopted by whoever saves next.
  // no config yet: a single-store business gets a fresh, unlabeled config;
  // a multi-store business has no safe store to bind it to, so it's refused
  // instead of silently taking the hardcoded (and possibly wrong) ids.
  const misfiled = existing
    ? !existing.karute_store_id || existing.karute_store_id !== storeId
    : (await synqed.stores.list()).stores.length > 1

  if (misfiled) {
    return NextResponse.json(
      {
        error: 'qr_store_not_ready',
        // Dev/log-facing only — the settings UI shows its own localized
        // copy (messages/*.json: settings.bookingSyncStoreNotReady) keyed
        // off the error code above, never this string.
        message: "Quick Reserve sync isn't wired up for this store yet.",
      },
      { status: 409 },
    )
  }

  try {
    await synqed.sync.upsertConfig('QUICKRESERVE', {
      username,
      // Only send the password when the owner typed one — core keeps the stored
      // credential otherwise (the field renders blank on load by design).
      ...(password ? { password } : {}),
      enabled,
      // Carry forward whatever store identifiers the existing config already
      // has (La Estro's row keeps its la-estro/222) — never invent/hardcode
      // them for a config that doesn't already carry them (the guard above
      // only lets a brand-new config through for a single-store business,
      // which has no store_slug/store_id to give it).
      ...(existing?.store_slug ? { store_slug: existing.store_slug } : {}),
      ...(existing?.store_id ? { store_id: existing.store_id } : {}),
    })
  } catch (e) {
    // The old route never checked the write and always returned success — the
    // "Config saved" false positive. Surface the real failure now.
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
    detail: { enabled: Boolean(enabled), password_changed: Boolean(password) },
  })

  return NextResponse.json({ success: true })
}
