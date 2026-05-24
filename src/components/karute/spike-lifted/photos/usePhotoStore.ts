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
 * Sample placeholder photos using picsum.photos (same approach as
 * the spike). Gives Liam something visual to look at without needing
 * Storage wiring. Empty array = "no photos yet" empty state on the
 * card — toggle the export below to test both states.
 */
const SAMPLE_PHOTOS: PhotoRecord[] = [
  {
    id: 'spk-sample-1',
    karuteId: 'spk-karute-1',
    customerId: 'spk-customer-1',
    capturedByStaffId: 'spk-staff-1',
    capturedByStaffName: '佐藤 あかり',
    capturedAt: '2026-04-20T14:30:00+09:00',
    capturedAtLabel: '2026年4月20日',
    categoryKey: 'skin_state',
    categoryLabelSnapshot: '肌状態',
    storageUrl: 'https://picsum.photos/seed/skin-1/800/800',
    thumbnailUrl: 'https://picsum.photos/seed/skin-1/400/400',
    width: 800,
    height: 800,
    takenWithConsent: true,
  },
  {
    id: 'spk-sample-2',
    karuteId: 'spk-karute-1',
    customerId: 'spk-customer-1',
    capturedByStaffId: 'spk-staff-1',
    capturedByStaffName: '佐藤 あかり',
    capturedAt: '2026-04-20T15:30:00+09:00',
    capturedAtLabel: '2026年4月20日',
    categoryKey: 'after',
    categoryLabelSnapshot: '施術後',
    storageUrl: 'https://picsum.photos/seed/after-1/800/800',
    thumbnailUrl: 'https://picsum.photos/seed/after-1/400/400',
    width: 800,
    height: 800,
    takenWithConsent: true,
  },
  {
    id: 'spk-sample-3',
    karuteId: 'spk-karute-1',
    customerId: 'spk-customer-1',
    capturedByStaffId: 'spk-staff-1',
    capturedByStaffName: '佐藤 あかり',
    capturedAt: '2026-03-22T14:00:00+09:00',
    capturedAtLabel: '2026年3月22日',
    categoryKey: 'skin_state',
    categoryLabelSnapshot: '肌状態',
    storageUrl: 'https://picsum.photos/seed/skin-2/800/800',
    thumbnailUrl: 'https://picsum.photos/seed/skin-2/400/400',
    width: 800,
    height: 800,
    takenWithConsent: true,
  },
  {
    id: 'spk-sample-4',
    karuteId: 'spk-karute-1',
    customerId: 'spk-customer-1',
    capturedByStaffId: 'spk-staff-1',
    capturedByStaffName: '佐藤 あかり',
    capturedAt: '2026-03-22T15:00:00+09:00',
    capturedAtLabel: '2026年3月22日',
    categoryKey: 'after',
    categoryLabelSnapshot: '施術後',
    storageUrl: 'https://picsum.photos/seed/after-2/800/800',
    thumbnailUrl: 'https://picsum.photos/seed/after-2/400/400',
    width: 800,
    height: 800,
    takenWithConsent: true,
  },
]

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
