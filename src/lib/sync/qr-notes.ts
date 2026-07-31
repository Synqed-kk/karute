// Canonical parser for the QuickReserve back-reference the karute QR sync stamps
// into appointment.notes. Until synqed-core lets us write external_refs, the QR
// reservation id lives ONLY in notes, as the exact prefix `QR #<id> | <memo>`,
// and the sync keys appointments off it — matching a moved/rebooked reservation
// to its OWN row instead of hijacking whoever currently holds the slot. Single-
// sourced here so the keyer, the cancel-sweep, and the memo display can never
// disagree on the format.

/**
 * The notes prefix: `QR #<digits> | `. Anchored to the string start and
 * digits-only, so a hand-typed memo that merely contains "QR #…" mid-string, or
 * a non-numeric token, never reads as a QR id. The id is captured in group 1.
 *
 * NOTE: keying off this is a back-reference, NOT a cancel authority — a manual
 * walk-in memo could be typed to start `QR #123 | `. The cancel-sweep gates on
 * appointment.source in addition to this prefix (see the sync route).
 */
export const QR_NOTES_PREFIX_RE = /^\s*QR\s*#(\d+)\s*\|\s*/

/** The QR reservation id from an appointment's notes, or null if not QR-keyed. */
export function parseQrId(notes: string | null | undefined): string | null {
  if (!notes) return null
  const m = notes.match(QR_NOTES_PREFIX_RE)
  return m ? m[1] : null
}

/** Whether an appointment's notes carry the `QR #<id> | ` back-reference. */
export function isQrOwned(notes: string | null | undefined): boolean {
  return parseQrId(notes) !== null
}

/** The human memo with the `QR #<id> | ` prefix stripped (for display / AI brief). */
export function stripQrPrefix(notes: string | null | undefined): string {
  if (!notes) return ''
  return notes.replace(QR_NOTES_PREFIX_RE, '').trim()
}

/** A bare QR back-reference with NO memo behind it: `QR #123`, `QR #123 |`,
 *  `QR #123 | ` — the sync writes this when the QuickReserve reservation had
 *  no memo. Distinct from QR_NOTES_PREFIX_RE, which requires the pipe. */
const QR_BARE_TAG_RE = /^\s*QR\s*#\d+\s*\|?\s*$/

/**
 * The HUMAN memo content of a notes field, or null when there is none.
 * The QR back-reference is sync plumbing — it must never be shown as
 * 「ご予約時のメモ」 nor fed to the AI as the customer's booking words
 * (production bug: the brief displayed "QR #328091" as the memo while the
 * customer's real QuickReserve intake memo sat unused on customer.notes).
 */
export function memoContent(notes: string | null | undefined): string | null {
  if (!notes) return null
  if (QR_BARE_TAG_RE.test(notes)) return null
  const stripped = stripQrPrefix(notes)
  return stripped || null
}

// ── QuickReserve intake-memo structure ──────────────────────────────────────
// La Estro's staff type a semi-structured intake into the QR booking memo
// ("▶症状:… ▶ゴール:… ▶セルフ:…"). Both the カルテ customer tab (BookingMemoCard)
// and the pre-session briefing (PreSessionBriefCard) parse it into labeled rows,
// so the parse lives here — single-sourced next to stripQrPrefix, which it uses —
// and both surfaces stay in lock-step on the format.

/** QR memo keys → display labels. Unknown keys fall back to the raw key. */
export const QR_MEMO_LABELS: Record<string, string> = {
  回数: '回数券',
  症状: '症状・お悩み',
  既往: '既往歴',
  ゴール: 'ゴール',
  セルフ: 'セルフケア',
  参考: '備考',
}

export interface QrMemoRow {
  label: string
  value: string
}

/**
 * Parse "▶key:value▶key:value" (optionally prefixed "QR #id | ") into labeled
 * rows. Returns null when there's no ▶ structure so the caller can fall back to
 * rendering the raw text. Segment order is preserved; empty values are KEPT here
 * (as ''), so each caller decides how to present them — the customer tab shows a
 * dash, the briefing omits them.
 */
export function parseQrMemo(raw: string): QrMemoRow[] | null {
  const body = stripQrPrefix(raw)
  if (!body.includes('▶')) return null
  return body
    .split('▶')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const m = seg.match(/^([^:：]+)[:：]\s*([\s\S]*)$/)
      if (!m) return { label: '', value: seg }
      const key = m[1].trim()
      return { label: QR_MEMO_LABELS[key] ?? key, value: m[2].trim() }
    })
}
