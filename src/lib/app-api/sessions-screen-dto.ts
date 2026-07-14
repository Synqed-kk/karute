// Versioned, runtime-validated DTO for the sessions-list (カルテ tab) screen
// facade read (packet 05, inventory #3). Screen-shaped: this IS the
// KaruteRecordListView prop surface, serialized — items/placeholders are built
// by the SAME buildSessionsListScreen the web page renders from, so web and
// mobile can never derive different rows.
//
// PARITY, not redesign: all records + placeholders ship, exactly like today's
// page (synqed-core karute capped at 200 via mergeKaruteRows; customers paged to
// completion). No invented pagination — the report records the row-count reality
// so pagination can be a later, evidenced decision.

import { z } from 'zod'
import { STAFF_COLOR_KEYS } from '@/lib/staff-colors'

// Mirrors KaruteListItem (src/components/karute/spike-lifted/list/types.ts).
// staffColorKey is the controlled palette enum + 'neutral' fallback (never a
// free string), so a bad server value fails the parse instead of rendering a
// broken swatch. The thin screen re-parses with this same schema.
const KaruteListItemDTO = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  customerInitials: z.string(),
  customerKaruteNumber: z.string(),
  date: z.string(),
  weekday: z.string(),
  service: z.string(),
  duration: z.number(),
  staffId: z.string().nullable(),
  staffColorKey: z.enum([...STAFF_COLOR_KEYS, 'neutral']).nullable(),
  staffName: z.string(),
  summary: z.string(),
  aiStatus: z.enum(['summarized', 'pending', 'needsReview', 'draft']),
  conversionStatus: z.enum(['active', 'provisional']),
  href: z.string(),
  isPlaceholder: z.boolean().optional(),
})

export const SessionsScreenDTO = z.object({
  /** Real karute records, date-desc, capped at 200 (mergeKaruteRows). */
  items: z.array(KaruteListItemDTO),
  /** Synthesized rows for customers with no karute yet (新規のお客様). */
  placeholders: z.array(KaruteListItemDTO),
  /** Karute records dated in the current month — status-line only. */
  monthCount: z.number(),
  /** Staff filter pills (id + display name + initials). */
  staffList: z.array(
    z.object({ id: z.string(), name: z.string(), initials: z.string() }),
  ),
  /** The caller's staff id when they are on the roster (Me filter). */
  currentStaffId: z.string().nullable(),
  /** New カルテ dialog combobox source (id + name). */
  customerOptions: z.array(z.object({ id: z.string(), name: z.string() })),
})

export type SessionsScreenDTOType = z.infer<typeof SessionsScreenDTO>
