import { NextRequest, NextResponse } from 'next/server'

// Mock insights data for development
const MOCK_INSIGHTS = [
  {
    id: 'ins-001',
    type: 'NEXT_TREATMENT',
    title: '根元のカラーリタッチ時期',
    body: '前回のカラーから約6週間が経過しています。根元の伸びが目立ち始める時期ですので、次回来店時にリタッチをご提案ください。',
    priority: 0.85,
    action: '次回予約時にカラーリタッチのメニューを提案する',
    evidence: '前回カラー施術日: 2026-01-25（6週間前）',
    status: 'ACTIVE',
  },
  {
    id: 'ins-002',
    type: 'CHURN_RISK',
    title: '来店間隔が通常より長い',
    body: '通常4週間ごとに来店されていましたが、現在6週間以上空いています。お客様の来店パターンに変化が見られます。',
    priority: 0.78,
    action: 'フォローアップの連絡を検討してください',
    evidence: '平均来店間隔: 28日、現在の経過日数: 45日',
    status: 'ACTIVE',
  },
  {
    id: 'ins-003',
    type: 'TALKING_POINT',
    title: 'お子さまの入学式について',
    body: '前回の施術中、お子さまの入学式が近いとお話しされていました。入学式の様子を伺うと喜ばれるでしょう。',
    priority: 0.55,
    action: '接客時に入学式の話題に触れる',
    evidence: 'カルテメモ（2026-02-10）: 「4月に長女の入学式」',
    status: 'ACTIVE',
  },
  {
    id: 'ins-004',
    type: 'UPSELL',
    title: 'トリートメントの追加提案',
    body: '直近3回の施術でダメージに関するご相談がありました。ホームケア用のトリートメント製品をご提案すると効果的です。',
    priority: 0.62,
    action: '施術中にヘアケア製品のサンプルを提供する',
    evidence: '直近3回のカルテに「毛先のパサつき」の記載あり',
    status: 'ACTIVE',
  },
  {
    id: 'ins-005',
    type: 'FOLLOW_UP',
    title: '前回のカラーの色持ち確認',
    body: '前回初めてのアッシュ系カラーを試されました。色落ちの具合や満足度を確認し、次回の調合に反映してください。',
    priority: 0.72,
    action: '来店時にカラーの色持ちについてヒアリングする',
    evidence: '前回施術: アッシュベージュ（初回）',
    status: 'ACTIVE',
  },
  {
    id: 'ins-006',
    type: 'HIGH_VALUE',
    title: '年間利用額上位のお客様',
    body: '過去12ヶ月で24回ご来店いただいており、年間利用額は上位10%に入ります。特別なケアやサービスを心がけてください。',
    priority: 0.45,
    action: '季節ごとの特別メニューや優先予約を案内する',
    evidence: '年間来店回数: 24回、平均単価: ¥12,500',
    status: 'ACTIVE',
  },
]

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const customerId = searchParams.get('customerId')

  if (!customerId) {
    return NextResponse.json(
      { error: 'customerId is required' },
      { status: 400 }
    )
  }

  // TODO: Fetch from database using customerId
  return NextResponse.json({ insights: MOCK_INSIGHTS })
}
