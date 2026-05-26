/**
 * Japanese phone-number display formatter.
 *
 * Strips dashes/spaces/leading `+81` from `raw`, then re-inserts dashes
 * in the canonical position for whichever JP number shape it matches:
 *   • Mobile (090/080/070 + 8 digits)  → `0XX-XXXX-XXXX`
 *   • Tokyo (03) / Osaka (06) landline → `0X-XXXX-XXXX`
 *   • Other 10-digit landlines         → `0XX-XXX-XXXX`
 *
 * Pure display layer. Returns `raw` unchanged when the input doesn't
 * match a recognized JP shape (legacy/foreign numbers stay readable
 * rather than getting garbled). Returns empty string for null/empty.
 *
 * Logic mirrors the design-spike's `normalizeJpPhone` helper so the
 * formatted output is identical across both apps. Display-only — DB
 * persistence is Anthony's call (`customers.normalized_phone` was
 * floated in the spike notes).
 *
 * For LIVE input formatting (as the staff types), use
 * `formatJpPhoneProgressive` below instead — this strict version is
 * for display of fully-typed values.
 */
export function formatJpPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''
  // Strip separators + leading international prefix.
  const digits = trimmed.replace(/[-\s]/g, '').replace(/^\+?81/, '0')
  if (!/^0\d{9,10}$/.test(digits)) return raw
  // Mobile — 3-4-4
  if (/^0[789]0\d{8}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    // Tokyo / Osaka — 2-4-4
    if (/^0[36]\d{8}$/.test(digits)) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`
    }
    // Default 3-3-4 (covers most 3-digit area codes)
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return raw
}

/**
 * Progressive JP phone formatter — adds dashes AS the staff types.
 *
 * Unlike `formatJpPhone` (which only formats fully-typed valid numbers),
 * this version inserts dashes at the canonical positions for partial
 * input, so staff see "080-0000-0006" forming live instead of having
 * to wait for blur or count digits themselves. Caps the digit count at
 * 11 (longest JP mobile) to prevent accidental over-typing.
 *
 * Format detection (locks in once enough digits are present):
 *   • First 3 digits = 070/080/090 → mobile, 3-4-4
 *   • First 2 digits = 03/06       → Tokyo/Osaka landline, 2-4-4
 *   • Anything else                → other landline, 3-3-4
 *
 * Strips all non-digits from input first, so paste of pre-formatted
 * numbers ("+81 80 1234 5678", "080.0000.0006", etc.) reformats
 * cleanly. Returns empty string for empty/null input.
 *
 * Wire to <input onChange> for live formatting; the JP phone shape is
 * fully predictable (3/4/4, 2/4/4, or 3/3/4 segments) so live insert
 * doesn't have ambiguous breakpoints like US (3)-3-4 vs 3-3-4. Cursor
 * position handling is intentionally simple (browser puts it at end
 * after the value updates) — that matches typing-forward UX. Editing
 * mid-field is rare for phone numbers and gracefully degrades.
 */
export function formatJpPhoneProgressive(raw: string | null | undefined): string {
  if (!raw) return ''
  // Cap at 11 digits — longest JP shape is mobile 0XX-XXXX-XXXX.
  // Extra digits are dropped silently so the staff can't accidentally
  // exceed the format by mashing the keypad.
  const digits = raw.replace(/\D/g, '').slice(0, 11)
  if (!digits) return ''

  // Mobile: 070 / 080 / 090. Lock in once 3rd digit is "0".
  if (digits.length >= 3 && /^0[789]0/.test(digits)) {
    if (digits.length <= 3) return digits
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
  }

  // Tokyo (03) / Osaka (06). Lock in once 2nd digit is 3 or 6.
  if (digits.length >= 2 && /^0[36]/.test(digits)) {
    if (digits.length <= 2) return digits
    if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`
    // Tokyo/Osaka land lines are 10 digits — cap segment 3 at 4 chars
    // (slicing past length 10 returns '' so the result stays clean).
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6, 10)}`
  }

  // Default: other 0XX-XXX-XXXX landlines.
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`
}
