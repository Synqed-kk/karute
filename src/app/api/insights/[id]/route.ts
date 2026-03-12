import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { status } = body

  if (!status || !['ACTIVE', 'DISMISSED', 'ACTIONED', 'EXPIRED'].includes(status)) {
    return NextResponse.json(
      { error: 'Valid status is required (ACTIVE, DISMISSED, ACTIONED, EXPIRED)' },
      { status: 400 }
    )
  }

  // TODO: Update insight status in database
  // await prisma.customerInsight.update({
  //   where: { id },
  //   data: { status },
  // })

  return NextResponse.json({
    success: true,
    id,
    status,
  })
}
