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
//
// 2026-08-25 (PR-2a 日付チャンク読み込み): that "later, evidenced decision"
// landed — the web page and the release-18 bundle now read the list in
// backward-walking DATE WINDOWS instead of one newest-200 slab. Parity is
// therefore VERSIONED, not broken: a bare GET still serves the schema below,
// byte-for-byte, for release-17 phones in the field; `?window=1` serves
// SessionsScreenWindowedDTO (base + hasMore + windowStart). The legacy path is
// scheduled for retirement once 17 ages out — named follow-up in the lane
// queue, never a silent removal.

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
  // ENUM-TOLERANCE RIDER (PR-2a, while the schema is open): a value the client
  // bundle doesn't know yet must degrade to the neutral/safe member, never
  // fail the whole screen parse. A release-17 phone meeting a palette key or
  // status added later would otherwise show an error screen instead of a list
  // — one unknown row colour is not worth a blank カルテ tab. The DEFAULTS are
  // the same ones the row renderer already treats as "unset".
  staffColorKey: z.enum([...STAFF_COLOR_KEYS, 'neutral']).nullable().catch(null),
  staffName: z.string(),
  summary: z.string(),
  aiStatus: z.enum(['summarized', 'pending', 'needsReview', 'draft']).catch('draft'),
  conversionStatus: z.enum(['active', 'provisional']).catch('provisional'),
  href: z.string(),
  isPlaceholder: z.boolean().optional(),
})

export const SessionsScreenDTO = z.object({
  /** Real karute records, date-desc, capped at 200 (mergeKaruteRows). */
  items: z.array(KaruteListItemDTO),
  /** Always []. Kept required — never delete — so release-17 phones can
   *  still parse this key (see buildSessionsListScreen's SessionsListScreen
   *  doc comment; PR-1a 未作成ブロック廃止 dropped the row synthesis). */
  placeholders: z.array(KaruteListItemDTO),
  /** Karute records dated in the current month — status-line only. */
  monthCount: z.number(),
  /** Store-wide karute total, unfiltered by date (PR-1b). Optional-typed with
   *  a safe default: an old cached/legacy payload that predates this field
   *  still parses, and every reader gets a real number, never undefined. Not
   *  rendered until PR-2a's 全件 display. */
  total: z.number().default(0),
  /** Staff filter pills (id + display name + initials). */
  staffList: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      initials: z.string(),
      /** 経営メンバー — for the 新規カルテ dialog's staff picker, and for
       *  StaffSelector's own default-list hiding (search reveals them;
       *  ⚖ 2026-09-01 overturn of Ⓒ). This array itself stays complete. */
      isManagement: z.boolean().optional(),
    }),
  ),
  /** The caller's staff id when they are on the roster (Me filter). */
  currentStaffId: z.string().nullable(),
  /** New カルテ dialog combobox source — id + name + phone/furigana for
   *  in-dialog phone/furigana search. */
  customerOptions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      furigana: z.string().nullable(),
    }),
  ),
})

export type SessionsScreenDTOType = z.infer<typeof SessionsScreenDTO>

/**
 * PR-2a 日付チャンク読み込み — the WINDOWED screen shape, served only when the
 * caller opts in with `?window=1` (the release-18 bundle does; a release-17
 * bundle sends a bare call and gets `SessionsScreenDTO` above, byte-identical
 * to what it has always received — pinned by the bare-call byte-parity test).
 *
 * ADDITIVE ONLY, and deliberately a separate schema rather than two optional
 * keys on the shared one: zod applies `.default()` at parse time, so merging
 * these fields into `SessionsScreenDTO` would INJECT them into the legacy
 * response body and break exactly the byte-parity the release-17 fleet depends
 * on. The opt-in param is the version negotiation; the split schema is how the
 * negotiation stays honest on the wire.
 *
 * FOLLOW-UP (named, not silent): the bare/legacy path retires once release 17
 * has aged out of the field — tracked in the lane queue, owner Liam's release
 * call. At that point this schema absorbs the base one and the split goes away.
 */
export const SessionsScreenWindowedDTO = SessionsScreenDTO.extend({
  /** Is there store history older than `windowStart` still unloaded?
   *  Server-computed via the ONE formula (karuteHasMore: loadedCount <
   *  freshStoreTotal) — the phone renders this field, the web view derives the
   *  identical formula client-side. */
  hasMore: z.boolean().default(false),
  /** YYYY-MM-DD (JST) — the oldest day the initial window reached. Feeds the
   *  さらに表示 label and the next chunk's `olderThan`. */
  windowStart: z.string().nullable().default(null),
})

export type SessionsScreenWindowedDTOType = z.infer<typeof SessionsScreenWindowedDTO>
