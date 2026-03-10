import { getOpenAI } from '@/lib/ai/openai'

export type ClassifiedEntryCategory =
  | 'SYMPTOM'
  | 'TREATMENT'
  | 'BODY_AREA'
  | 'PREFERENCE'
  | 'LIFESTYLE'
  | 'NEXT_VISIT'
  | 'PRODUCT'
  | 'OTHER'

export type ClassifiedEntry = {
  category: ClassifiedEntryCategory
  content: string
  originalQuote: string
  confidence: number
  tags: string[]
}

export type ClassificationResult = {
  summary: string
  entries: ClassifiedEntry[]
}

type ClassifyTranscriptParams = {
  transcript: string
  businessType?: string
}

/**
 * Returns the system prompt for classification, tailored to the business type.
 */
export function getClassificationPrompt(businessType: string): string {
  return `あなたはサロン・クリニックの会話記録を分析する専門AIアシスタントです。
業種: ${businessType}

以下の会話テキストを分析し、カルテに記載すべき重要な情報を分類してください。

各情報を以下のカテゴリに分類してください：
- SYMPTOM: 症状・悩み・不調（例：肩こり、頭痛、肌荒れ）
- TREATMENT: 施術内容・処置（例：カット、カラー、マッサージ）
- BODY_AREA: 部位・箇所（例：右肩、前髪、首まわり）
- PREFERENCE: 好み・要望（例：短めに、明るい色、強めの圧）
- LIFESTYLE: 生活習慣・ライフスタイル（例：デスクワーク、運動不足）
- NEXT_VISIT: 次回予約・フォローアップ（例：2週間後、次回カラー）
- PRODUCT: 商品・ホームケア推奨（例：シャンプー、ストレッチ）
- OTHER: その他の重要な情報

ルール：
1. 会話から具体的な情報のみを抽出してください
2. 各エントリには元の発言（originalQuote）を含めてください
3. confidence は 0.0〜1.0 で、情報の確実性を示してください
4. tags には関連するキーワードを含めてください
5. summary には会話全体の簡潔な要約を日本語で記載してください`
}

const CLASSIFICATION_JSON_SCHEMA = {
  name: 'classification_result',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string' as const,
        description: '会話全体の簡潔な要約',
      },
      entries: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string' as const,
              enum: [
                'SYMPTOM',
                'TREATMENT',
                'BODY_AREA',
                'PREFERENCE',
                'LIFESTYLE',
                'NEXT_VISIT',
                'PRODUCT',
                'OTHER',
              ],
            },
            content: {
              type: 'string' as const,
              description: '分類された情報の内容',
            },
            originalQuote: {
              type: 'string' as const,
              description: '元の会話からの引用',
            },
            confidence: {
              type: 'number' as const,
              description: '0.0〜1.0の確信度',
            },
            tags: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: '関連キーワード',
            },
          },
          required: ['category', 'content', 'originalQuote', 'confidence', 'tags'],
          additionalProperties: false,
        },
      },
    },
    required: ['summary', 'entries'],
    additionalProperties: false,
  },
}

/**
 * Classifies a transcript using OpenAI GPT-4o with structured output.
 *
 * Analyzes salon/clinic conversation text and extracts structured entries
 * categorized by type (symptom, treatment, preference, etc.).
 */
export async function classifyTranscript(
  params: ClassifyTranscriptParams
): Promise<ClassificationResult> {
  const { transcript, businessType = 'サロン' } = params

  if (!transcript.trim()) {
    throw new Error('Transcript is empty')
  }

  const openai = getOpenAI()
  const systemPrompt = getClassificationPrompt(businessType)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: transcript },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: CLASSIFICATION_JSON_SCHEMA,
    },
    temperature: 0.3,
  })

  const content = response.choices[0]?.message?.content

  if (!content) {
    throw new Error('No response from classification model')
  }

  const parsed = JSON.parse(content) as ClassificationResult

  return {
    summary: parsed.summary,
    entries: parsed.entries.map((entry) => ({
      category: entry.category,
      content: entry.content,
      originalQuote: entry.originalQuote,
      confidence: Math.min(1, Math.max(0, entry.confidence)),
      tags: entry.tags,
    })),
  }
}
