// LIFTED + SIMPLIFIED FROM SPIKE
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/lib/data/karute/photos.ts
//
// Spike version had:
//   - usePhotosForKarute(karuteId) — mock data read
//   - useLocalPhotoStore() — in-memory add
//   - capturePhoto / deletePhoto stubs (throw, marked for replacement)
//
// This adaptation collapses to one hook that returns sample
// placeholder photos + an in-memory add slot so PhotoRecordCard can
// render and react to (future) captures.
//
// ANTHONY: production swap is documented at the top of the spike's
// photos.ts file (verbatim Supabase template). When you wire the
// real `karute_photos` table + Storage bucket:
//   1. Delete the SAMPLE_PHOTOS array below.
//   2. Replace the body of usePhotosForKarute with the
//      useQuery+supabase template from the spike file.
//   3. Replace addLocalPhoto with a real capturePhoto mutation
//      (upload to Storage + insert row).
//   4. The PhotoRecordCard component itself stays unchanged — it
//      reads PhotoRecord[] and doesn't know about the source.

import { useState } from 'react'
import type { PhotoRecord } from './types'

/**
 * Empty by default. Previous version of this file shipped 4 sample
 * photos via picsum.photos, which made the empty-state code path
 * untestable AND made every customer's karute look like staff had
 * already taken progress photos (they hadn't). Same wrongness as
 * the memory card's SAMPLE_MEMORY — deleted.
 *
 * ANTHONY: when you wire the real `karute_photos` table, swap this
 * empty array for a Supabase query (template in the spike's
 * src/lib/data/karute/photos.ts top-of-file). Until then, every
 * customer correctly shows "まだ写真がありません" / equivalent.
 */
const SAMPLE_PHOTOS: PhotoRecord[] = []

export interface PhotoStore {
  photos: PhotoRecord[]
  addPhoto: (photo: PhotoRecord) => void
}

/**
 * Returns the placeholder photo set + an in-memory add slot.
 * No karute / customer filtering yet — every customer profile
 * shows the same samples until Anthony wires the real query.
 */
export function usePhotoStore(): PhotoStore {
  const [extra, setExtra] = useState<PhotoRecord[]>([])
  const photos = [...extra, ...SAMPLE_PHOTOS]
  const addPhoto = (photo: PhotoRecord) =>
    setExtra((prev) => [photo, ...prev])
  return { photos, addPhoto }
}
