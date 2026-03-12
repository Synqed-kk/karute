import OpenAI from 'openai'

// Types
export type InsightType =
  | 'NEXT_TREATMENT'
  | 'FOLLOW_UP'
  | 'CHURN_RISK'
  | 'UPSELL'
  | 'TALKING_POINT'
  | 'HIGH_VALUE'
  | 'GENERAL'
  | 'REACTIVATION'
  | 'UNRESOLVED_ISSUE'
  | 'PHOTO_REQUEST'
  | 'PLAN_INCOMPLETE'

export interface Insight {
  type: InsightType
  title: string
  body: string
  priority: number // 0-1 float
  action: string | null
  evidence: string | null
}

interface GenerateInsightsParams {
  customerId: string
  orgId: string
  customerProfile: {
    name: string
    nameKana?: string | null
    tags?: string[]
    notes?: string | null
    visitCount?: number
    lastVisit?: string | null
  }
  timeline: Array<{
    type: string
    title: string
    body?: string | null
    occurredAt: string
  }>
  karuteRecords: Array<{
    aiSummary?: string | null
    entries: Array<{
      category: string
      content: string
    }>
    createdAt: string
  }>
}

const SYSTEM_PROMPT = `あなたは美容サロンのAIアシスタントです。顧客データを分析し、スタイリストが次回の施術に活用できる実用的なインサイトを生成してください。

以下の種類のインサイトを生成してください：
- NEXT_TREATMENT: 次回の施術に関する提案
- FOLLOW_UP: フォローアップが必要な事項
- CHURN_RISK: 来店頻度の低下や離反リスク
- UPSELL: アップセルの機会
- TALKING_POINT: 接客時の話題
- HIGH_VALUE: 重要顧客に関する特記事項
- GENERAL: その他の一般的なインサイト

各インサイトには以下を含めてください：
- type: インサイトの種類（上記のいずれか）
- title: 簡潔なタイトル（日本語）
- body: 詳細な説明（日本語、2-3文）
- priority: 重要度（0.0〜1.0の小数、1.0が最も重要）
- action: 推奨アクション（日本語、1文）
- evidence: 根拠となるデータ（日本語、1文）

JSON配列で5〜8個のインサイトを返してください。`

function getOpenAI(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }
  return new OpenAI({ apiKey })
}

function buildUserPrompt(params: GenerateInsightsParams): string {
  const { customerProfile, timeline, karuteRecords } = params

  const sections: string[] = []

  // Customer profile
  sections.push(`## 顧客プロフィール
- 名前: ${customerProfile.name}
- タグ: ${customerProfile.tags?.join(', ') || 'なし'}
- メモ: ${customerProfile.notes || 'なし'}
- 来店回数: ${customerProfile.visitCount ?? '不明'}
- 最終来店: ${customerProfile.lastVisit || '不明'}`)

  // Timeline
  if (timeline.length > 0) {
    const timelineText = timeline
      .slice(0, 20) // Limit to recent events
      .map((e) => `- ${e.occurredAt}: [${e.type}] ${e.title}${e.body ? ` — ${e.body}` : ''}`)
      .join('\n')
    sections.push(`## タイムライン（直近）\n${timelineText}`)
  }

  // Karute records
  if (karuteRecords.length > 0) {
    const karuteText = karuteRecords
      .slice(0, 10)
      .map((r) => {
        const entries = r.entries
          .map((e) => `  - [${e.category}] ${e.content}`)
          .join('\n')
        return `### カルテ（${r.createdAt}）\nAI要約: ${r.aiSummary || 'なし'}\n${entries}`
      })
      .join('\n\n')
    sections.push(`## カルテ記録\n${karuteText}`)
  }

  return sections.join('\n\n')
}

export async function generateInsights(
  params: GenerateInsightsParams
): Promise<Insight[]> {
  const openai = getOpenAI()

  const userPrompt = buildUserPrompt(params)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 2000,
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from OpenAI')
  }

  const parsed = JSON.parse(content)
  const insights: Insight[] = Array.isArray(parsed) ? parsed : parsed.insights ?? []

  // Validate and normalize
  return insights
    .filter(
      (i) =>
        typeof i.type === 'string' &&
        typeof i.title === 'string' &&
        typeof i.body === 'string' &&
        typeof i.priority === 'number'
    )
    .map((i) => ({
      type: i.type as InsightType,
      title: i.title,
      body: i.body,
      priority: Math.max(0, Math.min(1, i.priority)),
      action: i.action ?? null,
      evidence: i.evidence ?? null,
    }))
    .sort((a, b) => b.priority - a.priority)
}
