// 予約の色分け (⚖ PKT-S38 R1/R2) — ONE HOME for the board's four category colours, the closed palette a
// store picks them from, and the per-store resolver. IMPORT-FREE on purpose: the practice door's writer
// checks a save against BOOKING_PALETTE, and the door may not reach ./fixtures or ./fixtures-today
// through today-board.ts. today-board.ts re-exports all of it, so no existing import moves.

/** The board's four booking categories (today-board.ts `BookingCategory`) → one colour each. */
export type BookingColors = { new: string; repeat: string; ticket: string; vip: string }
/** The board's colours as shipped before any store saved its own (= today.css `.event[data-cat=…] { --cat }`). */
export const BOOKING_COLOR_DEFAULTS: BookingColors = { new: '#3d7ab8', repeat: '#8a63b8', ticket: '#2f8f8f', vip: '#3f3f46' }
/** THE closed palette (R2): the four defaults first (new, repeat, ticket, vip), then the seven the 設定 dial
 *  offered before. A choice IS its lowercase `#rrggbb`. The STATUS colours (確定・要対応・停止) are deliberately
 *  NOT here: they are the family's own safety rule and no store may repaint them. */
export const BOOKING_PALETTE: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: BOOKING_COLOR_DEFAULTS.new, label: '藍' },
  { hex: BOOKING_COLOR_DEFAULTS.repeat, label: '藤紫' },
  { hex: BOOKING_COLOR_DEFAULTS.ticket, label: '浅葱' },
  { hex: BOOKING_COLOR_DEFAULTS.vip, label: '墨' },
  { hex: '#3b6fd4', label: '青' },
  { hex: '#2b8a8a', label: '青緑' },
  { hex: '#7a5bd4', label: '紫' },
  { hex: '#c25a8f', label: '桃' },
  { hex: '#3f4a7d', label: '紺' },
  { hex: '#8a6a4f', label: '茶' },
  { hex: '#8a8a93', label: '灰' },
]
const HEX6 = /^#[0-9a-f]{6}$/i
/** `raw` = the business's org-settings `booking_colors` value, shape unknown ({ [storeId]: { new, repeat, ticket, vip } } when saved by PR-2). Per key: a `#rrggbb` string (case-insensitive, returned lowercase) or the default. Anything else (null, non-object, unknown store, bad hex) → the default for that key. */
export function bookingColorsFor(storeId: string | null, raw: unknown): BookingColors {
  const own = (o: unknown, k: string): unknown =>
    o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined
  const saved = storeId === null ? undefined : own(raw, storeId)
  const pick = (k: keyof BookingColors) => {
    const v = own(saved, k)
    return typeof v === 'string' && HEX6.test(v) ? v.toLowerCase() : BOOKING_COLOR_DEFAULTS[k]
  }
  return { new: pick('new'), repeat: pick('repeat'), ticket: pick('ticket'), vip: pick('vip') }
}
