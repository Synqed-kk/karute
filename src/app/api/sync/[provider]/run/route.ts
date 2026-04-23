import { NextResponse, type NextRequest } from 'next/server'
import { getSynqedClient } from '@/lib/synqed/client'
import type { SyncProvider } from '@/lib/synqed/sdk'

function providerFromParam(raw: string): SyncProvider | null {
  const upper = raw.toUpperCase()
  if (upper === 'QUICKRESERVE' || upper === 'SYNQED_RESERVE' || upper === 'SALON_BOARD' || upper === 'HOT_PEPPER') {
    return upper
  }
  return null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerRaw } = await params
  const provider = providerFromParam(providerRaw)
  if (!provider) return NextResponse.json({ error: 'Invalid provider' }, { status: 400 })

  const { orgId } = (await request.json().catch(() => ({}))) as { orgId?: string }
  if (!orgId) return NextResponse.json({ error: 'orgId required' }, { status: 400 })

  try {
    const client = getSynqedClient(orgId)
    const result = await client.sync.runNow(provider)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
