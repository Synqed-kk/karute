// LIFTED FROM SPIKE — types
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/mock/customer-memory.ts
// Trimmed to what the simplified karute lift needs. Full spike type
// has a richer history of edits + provenance per item; this version
// keeps just the fields the rendered card cares about so Anthony has
// a clean target shape to wire to the real `customer_memory_items`
// table.

export type MemoryCategory =
  | 'personal'
  | 'body'
  | 'preference'
  | 'goal'
  | 'lifestyle'

export type MemorySource = 'ai' | 'staff' | 'intake'

export interface MemoryItem {
  id: string
  category: MemoryCategory
  /** Short label — surfaces in talking-points + as the row's title. */
  label: string
  /** Free-form body. ~1-3 sentences. */
  body: string
  source: MemorySource
  /** ISO date for "captured at" display. */
  capturedAt: string
  /** When true, the item floats into the Talking Points block. */
  suggestTalkingPoint?: boolean
  /** When true, the item gets a pin icon next to the source label. */
  pinned?: boolean
}

export interface CustomerIntake {
  /** ISO date of first visit. */
  firstVisitAt: string
  /** Short fragments shown on the intake summary row.
   *  ex: ['Instagram経由', '定期メンテナンス希望'] */
  highlights: string[]
}

export interface CustomerMemory {
  customerId: string
  items: MemoryItem[]
  intake: CustomerIntake | null
  lastUpdatedAt: string
  /** Items added/updated in the most recent session. Drives the
   *  "今日のセッションで3件更新" badge. */
  updatedThisVisit: number
}

/**
 * Sample memory inline. Mirrors the spike's c1 (田中 美咲) seed for
 * realism. Empty array = empty-state path. ANTHONY: production reads
 * from `customer_memory_items` table per customerId; this constant
 * disappears when that ships.
 */
export const SAMPLE_MEMORY: CustomerMemory = {
  customerId: 'sample-c1',
  intake: {
    firstVisitAt: '2026-02-10',
    highlights: ['Instagram経由', '定期メンテナンス希望'],
  },
  lastUpdatedAt: '2026-03-22T15:00:00+09:00',
  updatedThisVisit: 2,
  items: [
    {
      id: 'mem-1',
      category: 'personal',
      label: '愛犬ラグ（柴犬・3歳）',
      body: '昨年保護施設から引き取り。花粉アレルギーあり。散歩は朝夕1時間ずつ。',
      source: 'ai',
      capturedAt: '2026-02-10',
      suggestTalkingPoint: true,
      pinned: true,
    },
    {
      id: 'mem-2',
      category: 'personal',
      label: '先月京都旅行',
      body: '久しぶりの家族旅行で嵐山へ。竹林が気に入ったとのこと。',
      source: 'ai',
      capturedAt: '2026-03-22',
      suggestTalkingPoint: true,
    },
    {
      id: 'mem-3',
      category: 'personal',
      label: 'ご主人と二人暮らし',
      body: 'ご主人は金融系、帰りが遅いとのこと。',
      source: 'ai',
      capturedAt: '2026-02-10',
    },
    {
      id: 'mem-4',
      category: 'body',
      label: '頬の乾燥（花粉季に悪化）',
      body: '3月下旬から悪化。ピリピリ感あり。',
      source: 'ai',
      capturedAt: '2026-03-22',
      suggestTalkingPoint: true,
      pinned: true,
    },
    {
      id: 'mem-5',
      category: 'body',
      label: '長時間デスクによる肩こり',
      body: '在宅勤務でほぼ終日座り姿勢。2月時点が主訴、現在は改善傾向。',
      source: 'intake',
      capturedAt: '2026-02-10',
      pinned: true,
    },
    {
      id: 'mem-6',
      category: 'preference',
      label: '無香料製品が好み',
      body: '香水・強い香りが苦手。施術前の店内BGMもクラシック希望。',
      source: 'staff',
      capturedAt: '2026-02-10',
    },
    {
      id: 'mem-7',
      category: 'preference',
      label: '保湿系コスメに興味',
      body: '春先の乾燥対策で新しいケア商品を探している。',
      source: 'ai',
      capturedAt: '2026-03-22',
    },
    {
      id: 'mem-8',
      category: 'goal',
      label: '6月までに肌コンディションを整えたい',
      body: '結婚記念日（6月15日）に夫婦写真を撮る予定。',
      source: 'ai',
      capturedAt: '2026-03-22',
    },
    {
      id: 'mem-9',
      category: 'lifestyle',
      label: 'ITエンジニア（在宅中心）',
      body: '座り仕事中心。日中はほぼ室内、紫外線対策は意識的に。',
      source: 'intake',
      capturedAt: '2026-02-10',
    },
  ],
}
