// Session-outcome types — the coaching training-data label per session.
// Client-safe (no server-only imports) so the dialog + SaveKaruteInput can use
// them. The server action lives in ./outcome.ts.

export type Outcome = 'success' | 'no_deal' | 'pending' // 成約 / 不成約 / 後で決める

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
