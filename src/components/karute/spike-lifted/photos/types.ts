// LIFTED FROM SPIKE — types
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/mock/photo-records.ts
// Verbatim copy of the PhotoRecord interface so the component code below
// stays identical to the spike's shape. When Anthony wires the real
// `karute_photos` table, this type maps directly onto the row (camelCase
// projection of the snake_case columns).

export interface PhotoRecord {
  id: string
  karuteId: string
  customerId: string
  /** Optional — present only if the photo was captured during a
   *  specific booking/session. Lets the gallery group photos by
   *  visit if we want that later. */
  bookingId?: string
  capturedByStaffId: string
  capturedByStaffName: string
  /** ISO-8601. Display formatting happens in the component. */
  capturedAt: string
  /** Display date. Production formats `capturedAt` at render time;
   *  the spike pre-formats for simplicity, kept here to preserve the
   *  drop-in nature of the lifted card component. */
  capturedAtLabel: string
  /** → PhotoCategory.key */
  categoryKey: string
  /** Label at capture time. Survives category renames/archivals. */
  categoryLabelSnapshot: string
  /** Optional free-form caption. */
  caption?: string
  /** Full-resolution image URL. In production, a short-lived signed
   *  URL from Supabase Storage. */
  storageUrl: string
  /** 400×400 thumbnail URL. Same signed-URL pattern. */
  thumbnailUrl: string
  width: number
  height: number
  takenWithConsent: boolean
}

export type PhotoCategoryColor =
  | 'blue'
  | 'amber'
  | 'green'
  | 'indigo'
  | 'rose'
  | 'slate'

export interface PhotoCategory {
  key: string
  labelJa: string
  labelEn: string
  color: PhotoCategoryColor
  isDefault?: boolean
}

/**
 * Salon-default category seeds. Lifted from spike's
 * src/mock/photo-categories.ts — full set there has 30+ categories
 * across business types (salon / chiro / nail / esthetic). Pulled the
 * 5 most common here to keep the lift small. ANTHONY: when the
 * `photo_categories` table ships, seed it from the spike's full mock
 * (already SQL-ready in that file's INTEGRATION NOTES block).
 */
export const DEFAULT_PHOTO_CATEGORIES: PhotoCategory[] = [
  {
    key: 'before',
    labelJa: '施術前',
    labelEn: 'Before',
    color: 'amber',
    isDefault: true,
  },
  {
    key: 'after',
    labelJa: '施術後',
    labelEn: 'After',
    color: 'green',
    isDefault: true,
  },
  { key: 'skin_state', labelJa: '肌状態', labelEn: 'Skin', color: 'blue' },
  { key: 'reference', labelJa: '参考', labelEn: 'Reference', color: 'indigo' },
  { key: 'concern', labelJa: '気になる箇所', labelEn: 'Concern', color: 'rose' },
]

export function findCategoryByKey(key: string): PhotoCategory | undefined {
  return DEFAULT_PHOTO_CATEGORIES.find((c) => c.key === key)
}
