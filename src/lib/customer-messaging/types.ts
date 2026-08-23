// ─────────────────────────────────────────────────────────────
// Customer messaging — types
// ─────────────────────────────────────────────────────────────
// Lifted from spike: src/lib/customer-messaging.ts (types
// section). Mutations live in ./hooks.ts.

export type MessageChannel = 'line' | 'sms' | 'email' | 'other'

/** Where the compose flow was opened from — used by the log/
 *  audit row to distinguish origins (post-karute follow-up,
 *  dashboard AI action, manual ad-hoc send, etc). */
export type MessageSource =
  | 'karute_followup'
  | 'dashboard_ai_action'
  | 'manual'
  | 'reengagement'

export interface LogMessageInput {
  customerId: string
  channel: MessageChannel
  body: string
  source: MessageSource
  /** True when `body` was AI-drafted (Sonnet nightly or Haiku ranker). */
  aiDrafted?: boolean
  /** Links back to a dashboard AI action so it can auto-resolve. */
  aiActionId?: string
  /** True when the staff hit "copy + mark sent" — false for the
   *  copy-only path so the row tracks the draft was prepared
   *  even if the send was never asserted. */
  markSent: boolean
}
