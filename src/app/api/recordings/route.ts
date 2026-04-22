import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { batchCustomerNames, batchStaffNames } from '@/lib/synqed/batch'

// GET /api/recordings?orgId=xxx&date=2026-03-12
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const orgId = searchParams.get('orgId')
  const date = searchParams.get('date') // YYYY-MM-DD

  if (!orgId) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 })
  }

  const where: Record<string, unknown> = { orgId }

  if (date) {
    const start = new Date(`${date}T00:00:00`)
    const end = new Date(`${date}T23:59:59`)
    where.createdAt = { gte: start, lte: end }
  }

  const sessions = await prisma.recordingSession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  const customerIds = sessions.map((s) => s.customerId).filter((id): id is string => !!id)
  const staffIds = sessions.map((s) => s.staffId).filter((id): id is string => !!id)
  const [customerNames, staffNames] = await Promise.all([
    batchCustomerNames(orgId, customerIds),
    batchStaffNames(orgId, staffIds),
  ])

  const enriched = sessions.map((s) => ({
    ...s,
    staff: s.staffId
      ? { id: s.staffId, name: staffNames.get(s.staffId)?.name ?? null }
      : null,
    customer: s.customerId
      ? { id: s.customerId, name: customerNames.get(s.customerId)?.name ?? null }
      : null,
  }))

  return NextResponse.json(enriched)
}

// POST /api/recordings — create a new recording session
export async function POST(request: Request) {
  const body = await request.json()
  const { orgId, staffId, customerId, startsAt, status } = body

  if (!orgId || !staffId) {
    return NextResponse.json({ error: 'orgId and staffId required' }, { status: 400 })
  }

  const session = await prisma.recordingSession.create({
    data: {
      orgId,
      staffId,
      customerId: customerId || null,
      status: status || 'RECORDING',
      ...(startsAt ? { createdAt: new Date(startsAt) } : {}),
    },
  })

  return NextResponse.json(session)
}
