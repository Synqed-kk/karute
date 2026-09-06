import { NextResponse } from 'next/server'
import { requireBusinessAdmission } from '@/business/lib/admission'
import { normalizeCardColor } from '@/business/lib/reserve-card-color'
import { can } from '@/lib/auth/require-permission'
import { getBusinessId } from '@/lib/staff'
import { getSynqedClient } from '@/lib/synqed/client'

export const dynamic = 'force-dynamic'
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
async function authorize() {
  const admission = await requireBusinessAdmission()
  if (!(await can('business.manage')) || (await getBusinessId()) !== admission.businessId) throw new Error('forbidden')
  const client = await getSynqedClient()
  return { client, businessId: admission.businessId }
}
export async function GET() {
  let auth
  try { auth = await authorize() } catch { return reply({ error: 'forbidden' }, 403) }
  try {
    const org = await auth.client.orgSettings.get()
    return reply({ businessId: auth.businessId, name: org?.name ?? '', color: normalizeCardColor(org?.settings?.reserve_card_color) ?? null })
  } catch { return reply({ error: 'unavailable' }, 503) }
}
export async function PUT(request: Request) {
  // Cookie-authenticated mutation: only same-origin JSON requests are accepted.
  const origin = request.headers.get('origin')
  if (!origin || origin !== new URL(request.url).origin) return reply({ error: 'forbidden' }, 403)
  let auth
  try { auth = await authorize() } catch { return reply({ error: 'forbidden' }, 403) }
  if (request.headers.get('X-Expected-Business') !== auth.businessId) return reply({ error: 'business_changed' }, 409)
  let body: unknown
  try { body = await request.json() } catch { return reply({ error: 'invalid_color' }, 400) }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'color')) return reply({ error: 'invalid_color' }, 400)
  const color = normalizeCardColor((body as { color: unknown }).color)
  if (color === undefined) return reply({ error: 'invalid_color' }, 400)
  try {
    // Core merges only this key atomically; never send the full settings blob.
    await auth.client.orgSettings.upsert({ settings: { reserve_card_color: color } })
    return reply({ businessId: auth.businessId, color })
  } catch { return reply({ error: 'unavailable' }, 503) }
}
