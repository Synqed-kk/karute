import { NextResponse } from 'next/server'
import { auditWeb } from '@/lib/audit-web'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'

// QuickReserve connection settings live in synqed-core (sync_configs; the
// credentials are AES-encrypted server-side and never leave core). This route
// is a thin proxy over the SDK's sync namespace. getBusinessId() is the auth
// gate — it throws when there's no authenticated session.

export async function GET() {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const { username, password, enabled } = await request.json()
  const synqed = await getSynqedClient()

  try {
    await synqed.sync.upsertConfig('QUICKRESERVE', {
      username,
      // Only send the password when the owner typed one — core keeps the stored
      // credential otherwise (the field renders blank on load by design).
      ...(password ? { password } : {}),
      enabled,
      // QuickReserve store identifiers. Hardcoded for La Estro (the only QR
      // tenant today); parameterize when multi-store onboarding lands.
      store_slug: 'la-estro',
      store_id: 222,
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
    detail: { enabled: Boolean(enabled), password_changed: Boolean(password) },
  })

  return NextResponse.json({ success: true })
}
