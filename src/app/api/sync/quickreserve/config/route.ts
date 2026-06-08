import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getBusinessId } from '@/lib/staff'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

// sync_config holds the QuickReserve login (incl. password_encrypted). It's now
// RLS-locked with no anon policies, so it's reachable only via the service-role
// client below. getBusinessId() throws when there's no authenticated session,
// so it doubles as the auth gate this route previously lacked.
export async function GET() {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient() as SB

  const { data } = await supabase
    .from('sync_config')
    .select('username, enabled, last_sync_at, last_sync_status, last_sync_error')
    .eq('provider', 'quickreserve')
    .single()

  if (!data) {
    return NextResponse.json({ username: '', enabled: false, lastStatus: null })
  }

  return NextResponse.json({
    username: data.username,
    enabled: data.enabled,
    lastStatus: data.last_sync_status
      ? `${data.last_sync_status}${data.last_sync_error ? ': ' + data.last_sync_error : ''} (${data.last_sync_at ? new Date(data.last_sync_at).toLocaleString() : 'never'})`
      : null,
  })
}

export async function POST(request: Request) {
  try {
    await getBusinessId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { username, password, enabled } = await request.json()
  const supabase = createServiceClient() as SB

  // Check if config exists
  const { data: existing } = await supabase
    .from('sync_config')
    .select('id')
    .eq('provider', 'quickreserve')
    .single()

  if (existing) {
    // Update
    const updateData: Record<string, unknown> = {
      username,
      enabled,
      updated_at: new Date().toISOString(),
    }
    // Only update password if provided (don't overwrite with empty)
    if (password) updateData.password_encrypted = password

    await supabase
      .from('sync_config')
      .update(updateData)
      .eq('id', existing.id)
  } else {
    // Create
    await supabase
      .from('sync_config')
      .insert({
        provider: 'quickreserve',
        base_url: 'la-estro',
        username,
        password_encrypted: password || '',
        enabled,
      })
  }

  return NextResponse.json({ success: true })
}
