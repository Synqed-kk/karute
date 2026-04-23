import { NextResponse, type NextRequest } from 'next/server'
import { getSynqedClient } from '@/lib/synqed/client'
import type { SyncProvider, UpsertSyncConfigInput } from '@/lib/synqed/sdk'

// This route is a thin proxy from karute's session-authenticated UI to synqed-core.
// It resolves orgId (tenantId) from the server session — in today's mock flow
// we accept ?orgId= — migrate to session-derived once auth is production-wired.

function providerFromParam(raw: string): SyncProvider | null {
  const upper = raw.toUpperCase()
  if (upper === 'QUICKRESERVE' || upper === 'SYNQED_RESERVE' || upper === 'SALON_BOARD' || upper === 'HOT_PEPPER') {
    return upper
  }
  return null
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerRaw } = await params
  const provider = providerFromParam(providerRaw)
  if (!provider) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })

  const orgId = request.nextUrl.searchParams.get('orgId')
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  try {
    const client = getSynqedClient(orgId)
    const config = await client.sync.getConfig(provider)
    return NextResponse.json(config ?? null)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Fetch failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerRaw } = await params
  const provider = providerFromParam(providerRaw)
  if (!provider) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })

  const body = (await request.json()) as UpsertSyncConfigInput & { orgId?: string }
  const { orgId, ...input } = body
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  try {
    const client = getSynqedClient(orgId)
    const config = await client.sync.upsertConfig(provider, input)
    return NextResponse.json(config)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
