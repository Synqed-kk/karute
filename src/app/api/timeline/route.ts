import { NextRequest, NextResponse } from 'next/server'
import type { TimelineEventData } from '@/lib/types/timeline'

const mockEvents: TimelineEventData[] = [
  {
    id: 't1', type: 'VISIT', title: 'カット + カラー',
    body: '担当: 田中太郎。カラーはアッシュブラウン。', source: 'booking',
    occurredAt: new Date().toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't2', type: 'TREATMENT', title: '肩周りの施術',
    body: '肩こりの改善。首の付け根を重点的にほぐし。', source: 'karute',
    occurredAt: new Date(Date.now() - 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't3', type: 'NOTE', title: 'メモを追加',
    body: 'ジアミン系カラー剤にアレルギーあり。要注意。', source: 'manual',
    occurredAt: new Date(Date.now() - 2 * 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't4', type: 'PHOTO', title: 'アフター写真を追加',
    body: 'カラー仕上がり', source: 'manual',
    occurredAt: new Date(Date.now() - 3 * 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't5', type: 'VISIT', title: 'カット',
    body: '担当: 鈴木。前髪カット + 毛先の整え。', source: 'booking',
    occurredAt: new Date(Date.now() - 10 * 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't6', type: 'CONTACT', title: 'リマインダー送信',
    body: '次回予約のリマインダーをSMSで送信', source: 'system',
    occurredAt: new Date(Date.now() - 14 * 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't7', type: 'MILESTONE', title: '来店10回達成',
    body: 'VIPステータスに昇格', source: 'system',
    occurredAt: new Date(Date.now() - 20 * 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
  {
    id: 't8', type: 'VISIT', title: 'トリートメント',
    body: '担当: 田中太郎。ヘッドスパ + トリートメント。', source: 'booking',
    occurredAt: new Date(Date.now() - 35 * 86400000).toISOString(), createdAt: new Date().toISOString(),
  },
]

export async function GET(request: NextRequest) {
  const customerId = request.nextUrl.searchParams.get('customerId')
  if (!customerId) {
    return NextResponse.json({ error: 'customerId is required' }, { status: 400 })
  }

  return NextResponse.json({
    events: mockEvents.sort(
      (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
    ),
  })
}
