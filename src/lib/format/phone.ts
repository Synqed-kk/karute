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
