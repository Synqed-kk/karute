// Session-outcome types — the coaching training-data label per session.
// Client-safe (no server-only imports) so the dialog + SaveKaruteInput can use
// them. The server action lives in ./outcome.ts.

// 成約 / 不成約 / 後で決める / 既存のお客様（通常ご来店）.
// 'revisit' is a returning customer's ordinary visit — NOT a sales outcome, so
// it never carries a `reason` and is excluded from the closing-rate formula
// (success ÷ (success + no_deal)).
export type Outcome = 'success' | 'no_deal' | 'pending' | 'revisit'

export type DeclineReason =
  | 'budget' // 予算
  | 'considering' // 検討中
  | 'mismatch' // 店舗ミスマッチ
  | 'follow_up' // 後日連絡予定
  | 'other' // その他

/** Reason chips, in display order. Default selection = 'considering' (spike). */
export const DECLINE_REASONS: DeclineReason[] = [
  'budget',
  'considering',
  'mismatch',
  'follow_up',
  'other',
]

export interface SessionOutcome {
  status: Outcome
  reason?: DeclineReason | null
  isFirstVisit?: boolean
}
