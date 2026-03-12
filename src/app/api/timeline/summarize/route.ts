import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { customerId, startDate, endDate } = body

  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  }

  // TODO: call OpenAI to summarize timeline events in the date range
  const mockSummary =
    '山田花子さんは過去1ヶ月で3回来店し、主にカット・カラーの施術を受けています。' +
    '肩こりの症状が続いており、デスクワークが原因と考えられます。' +
    'ストレッチ用バンドの購入を検討中。次回は2週間後の土曜午前を希望しています。'

  return NextResponse.json({ summary: mockSummary })
}
