import { NextResponse } from 'next/server'
import { auditWeb } from '@/lib/audit-web'
import { getBusinessId, getCurrentUserStaffId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'
import { getMyCapabilities, ensureCapability } from '@/lib/auth/require-permission'
import { errorBody, toAppApiError } from '@/lib/app-api/errors'
import { qrConfigForStore } from '@/lib/sync/qr-config'
import { resolveSyncRunStore, webSyncStoreError } from '@/lib/sync/resolve-run-store'

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

type Capabilities = Awaited<ReturnType<typeof getMyCapabilities>>

/** The store the form SHOWS (SyncSection sends it: ?storeId= on GET, body on
 *  POST), resolved ONLY through the helper the run uses — never the
 *  active-store cookie, so the screen, its save and its run agree. */
async function shownStore(
  synqed: Awaited<ReturnType<typeof getSynqedClient>>,
  capabilities: Capabilities,
  requested: unknown,
): Promise<string> {
  const { storeId } = await resolveSyncRunStore({
    synqed,
    authUserId: await getCurrentUserStaffId(),
    capabilities,
    requestedStoreId: typeof requested === 'string' && requested ? requested : null,
  })
  return storeId
}

/** The helper's errors as the run route answers them; anything else → 502. */
function failure(e: unknown, fallback: string) {
  const storeError = webSyncStoreError(e)
  if (storeError) return NextResponse.json(storeError.body, { status: storeError.status })
  return NextResponse.json({ error: e instanceof Error ? e.message : fallback }, { status: 502 })
}

export async function GET(request: Request) {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let capabilities: Capabilities
  try {
    capabilities = await getMyCapabilities()
    ensureCapability(capabilities, 'sync.view')
  } catch (err) {
    const apiErr = toAppApiError(err)
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status })
  }

  // The shown store's own row (CORE-43: one config per store). A store with
  // no row yet reads as unconfigured; qrStoreSlug pre-fills the Quick Reserve
  // account slug from a sibling store's row (one owner login, several stores).
  const synqed = await getSynqedClient()
  let found: Awaited<ReturnType<typeof qrConfigForStore>>
  try {
    const storeId = await shownStore(synqed, capabilities, new URL(request.url).searchParams.get('storeId'))
    found = await qrConfigForStore(synqed, storeId)
  } catch (e) {
    return failure(e, 'Could not read QuickReserve settings')
  }
  const { config, configs } = found
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

  let capabilities: Capabilities
  try {
    capabilities = await getMyCapabilities()
    ensureCapability(capabilities, 'sync.view')
  } catch (err) {
    const apiErr = toAppApiError(err)
    return NextResponse.json(errorBody(apiErr), { status: apiErr.status })
  }

  const { storeId: shown, username, password, enabled, qrStoreSlug, qrStoreId } = await request.json()
  // A save names the store its form shows; without one it is refused before
  // any lookup — never written onto a default store's row.
  if (typeof shown !== 'string' || !shown) {
    return NextResponse.json({ error: 'qr_store_not_ready' }, { status: 409 })
  }
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
  // a store-lookup failure returns the 502 shape the screen already shows; a
  // store this caller may not use is the run's 409 qr_store_not_ready.
  try {
    const storeId = await shownStore(synqed, capabilities, shown)
    const { config: existing, configs } = await qrConfigForStore(synqed, storeId)

    const slug = typeof qrStoreSlug === 'string' ? qrStoreSlug.trim() : ''
    const qrId = Number(qrStoreId)
    const login = typeof username === 'string' ? username.trim() : ''
    if (!existing && (!slug || !Number.isInteger(qrId) || qrId <= 0 || !login || !password)) {
      return NextResponse.json(
        { error: 'qr_store_required', message: 'A new store needs its Quick Reserve store and login.' },
        { status: 400 },
      )
    }
    // One Quick Reserve store crawls for ONE of our stores. Checked here across
    // the whole business (a clamped caller included) without naming the other
    // store; keyed on the numeric QR store id, never the slug (one owner
    // login serves several stores).
    if (!existing && configs.some((c) => c.karute_store_id !== storeId && Number(c.store_id) === qrId)) {
      return NextResponse.json({ error: 'qr_store_already_linked' }, { status: 409 })
    }

    await synqed.sync.upsertConfig('QUICKRESERVE', {
      // A blank login never overwrites a live row's stored one.
      username: existing && !login ? existing.username : username,
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
    // write itself (the old route's "Config saved" false positive). Core's
    // code is read from an object error too (the SDK keeps it on .code).
    if ((e as { code?: unknown } | null)?.code === 'qr_store_already_linked') {
      return NextResponse.json({ error: 'qr_store_already_linked' }, { status: 409 })
    }
    return failure(e, 'Could not save QuickReserve settings')
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
