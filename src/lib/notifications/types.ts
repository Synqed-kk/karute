// ─────────────────────────────────────────────────────────────
// Notification types — lifted from spike
// ─────────────────────────────────────────────────────────────
// Spike source: src/mock/notifications.ts (types section, lines
// 25-54). The mock SEED ARRAY is intentionally NOT lifted — per
// the karute project's no-fake-data rule, the panel ships with
// an empty state and Anthony's Supabase wiring populates it from
// real events (Stripe webhooks, cron jobs, RLS-scoped reads).

export type NotificationCategory =
  | 'booking'
  | 'billing'
  | 'memory_review'
  | 'customer_return'
  | 'mention'
  | 'coaching'
  | 'retention'
  | 'system'

export interface NotificationItem {
  id: string
  category: NotificationCategory
  /** Primary line — 1 sentence, under ~40 chars ideally.
   *  Bilingual fields keep the surface i18n-aware without a
   *  per-locale store. */
  titleJa: string
  titleEn: string
  /** Optional secondary line for context. Empty string = no body. */
  bodyJa: string
  bodyEn: string
  /** ISO timestamp. Relative time is formatted at render. */
  createdAt: string
  /** `null` = unread, ISO string = when marked read. */
  readAt: string | null
  /** Deep link — the panel uses next/navigation push() to route here
   *  on click. `null` = informational, no nav. */
  href: string | null
}
