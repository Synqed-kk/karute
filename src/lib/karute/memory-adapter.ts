// Adapter: persistent-store MemoryItem (src/lib/karute/memory-types.ts) →
// the spike card's CustomerMemory shape (spike-lifted/memory/types.ts).
//
// The two shapes diverge on purpose: the lib/store type carries the data we
// persist + reconcile (detail, confidence, source enum), while the card type
// carries only what it renders (body, capturedAt, pinned). This is the single
// seam between them, so the card never needs to know the store's schema.

import type { MemoryItem as LibMemoryItem } from './memory-types'
import type {
  CustomerMemory,
  MemoryItem as SpikeMemoryItem,
  MemorySource as SpikeSource,
} from '@/components/karute/spike-lifted/memory/types'

function mapSource(s: LibMemoryItem['source']): SpikeSource {
  // store enum (ai_extraction|staff|intake_form) → card enum (ai|staff|intake)
  return s === 'ai_extraction' ? 'ai' : s === 'intake_form' ? 'intake' : 'staff'
}

/**
 * Build the card's CustomerMemory from the persisted store items. `intake` stays
 * null until the intake-form capture lands; `updatedThisVisit` is 0 here (the
 * "N件更新" badge is driven by the session ingest, not the profile read).
 */
export function buildCustomerMemory(
  items: LibMemoryItem[],
  customerId: string,
): CustomerMemory {
  const spikeItems: SpikeMemoryItem[] = items.map((m) => ({
    id: m.id,
    category: m.category,
    label: m.label,
    body: m.detail ?? '',
    source: mapSource(m.source),
    capturedAt: (m.updatedAt || '').slice(0, 10),
    suggestTalkingPoint: m.suggestTalkingPoint,
    pinned: m.pinned,
  }))

  const lastUpdatedAt =
    items.reduce((max, m) => (m.updatedAt > max ? m.updatedAt : max), '') || ''

  return {
    customerId,
    items: spikeItems,
    intake: null,
    lastUpdatedAt,
    updatedThisVisit: 0,
  }
}
