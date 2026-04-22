import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/client'
import { batchCustomerNames, batchStaffNames } from '@/lib/synqed/batch'

// GET /api/karute/[id] — get a single karute record with entries and segments
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // First try to find by karute record ID
  let record = await prisma.karuteRecord.findUnique({
    where: { id },
    include: {
      entries: { orderBy: { sortOrder: 'asc' } },
      recordingSession: {
        include: {
          segments: { orderBy: { segmentIndex: 'asc' } },
        },
      },
    },
  })

  // If not found by karute ID, try by recording session ID
  if (!record) {
    record = await prisma.karuteRecord.findUnique({
      where: { recordingSessionId: id },
      include: {
        entries: { orderBy: { sortOrder: 'asc' } },
        recordingSession: {
          include: {
            segments: { orderBy: { segmentIndex: 'asc' } },
          },
        },
      },
    })
  }

  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Resolve customer + staff names via synqed-core
  const [customerNames, staffNames] = await Promise.all([
    record.customerId
      ? batchCustomerNames(record.orgId, [record.customerId])
      : Promise.resolve(new Map()),
    record.staffId
      ? batchStaffNames(record.orgId, [record.staffId])
      : Promise.resolve(new Map()),
  ])

  const enriched = {
    ...record,
    staff: record.staffId ? { name: staffNames.get(record.staffId)?.name ?? null } : null,
    customer: record.customerId ? { name: customerNames.get(record.customerId)?.name ?? null } : null,
  }

  return NextResponse.json(enriched)
}
