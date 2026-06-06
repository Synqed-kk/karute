// Customer Memory — client-safe types shared by the store, extractor, brief, and
// the customer-page card.

export type MemoryCategory =
  | 'personal' // pets, family, travel, hobbies, life events — the rapport bits
  | 'body' // persistent body state / conditions / patterns
  | 'preference' // treatment / product / service preferences
  | 'goal' // what the customer is trying to achieve
  | 'lifestyle' // job, stress, routine that shapes treatment

export type MemorySource = 'ai_extraction' | 'staff' | 'intake_form'

export const MEMORY_CATEGORIES: MemoryCategory[] = [
  'personal',
  'body',
  'preference',
  'goal',
  'lifestyle',
]

export interface MemoryItem {
  id: string
  category: MemoryCategory
  label: string
  detail: string | null
  source: MemorySource
  confidence: number
  pinned: boolean
  suggestTalkingPoint: boolean
}

/** One reconciliation op the extractor emits against existing memory. */
export interface MemoryDeltaOp {
  action: 'add' | 'update' | 'remove'
  /** Existing item id — required for update/remove. */
  id?: string | null
  category?: MemoryCategory | null
  label?: string | null
  detail?: string | null
  confidence?: number | null
  suggestTalkingPoint?: boolean | null
}
