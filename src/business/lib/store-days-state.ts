// ⚖ PKT-S30 F2 (m6 + m15) — the ONE home of how 設定's 臨時休業・特別営業日 lists change after a
// write. Pure: no imports, no I/O, safe on both sides of the client boundary — it lives here, not in
// practice-door/, because foundation.test.ts forbids any 'use client' file a value path into the door. SettingsScreen.tsx's
// store-days callbacks call ONLY these; each takes the write's own answer, so:
//   · the committed row is core's OWN returned row / array — the typed input is never an argument;
//   · a failed write (`{ ok: false }`) returns `prev` itself (same reference, byte-identical);
//   · 臨時休業 are kept in date order (P3-7), 特別営業日 are replaced wholesale by core's array.

/** One 臨時休業 as core returns it (only the fields the screen shows). */
export type ClosureCore = { id: string; date: string; reason: string | null }
/** One 特別営業日 as core returns it. */
export type SpecialCore = { date: string; open: string; close: string }
/** A write's answer, as the screen's fetch wrapper hands it over. */
export type WriteAnswer<T> = { ok: true; value: T } | { ok: false }

/** 臨時休業 added: core's row, inserted in date order (after any row of the same date); a row whose
 *  id is already listed replaces it. `null` (a failed read) stays `null` — the list is unknown. */
export function applyClosureAdded(prev: ClosureCore[] | null, answer: WriteAnswer<ClosureCore>): ClosureCore[] | null {
  if (!answer.ok || prev === null) return prev
  const row: ClosureCore = { id: answer.value.id, date: answer.value.date, reason: answer.value.reason }
  const rest = prev.filter((r) => r.id !== row.id)
  const at = rest.findIndex((r) => r.date > row.date)
  return at === -1 ? [...rest, row] : [...rest.slice(0, at), row, ...rest.slice(at)]
}

/** 臨時休業 removed: the answer carries the removed row's id. */
export function applyClosureRemoved(prev: ClosureCore[] | null, answer: WriteAnswer<string>): ClosureCore[] | null {
  if (!answer.ok || prev === null) return prev
  const id = answer.value
  return prev.filter((r) => r.id !== id)
}

/** 臨時休業 removed, the door's answer: its refreshed list (from its FRESH read) replaces the local one
 *  wholesale — every row the door sent, in date order — a stable sort, so same-date rows keep the
 *  door's order (the same order `applyClosureAdded` produces by inserting after same-date rows). */
export function applyClosuresReplaced(list: ReadonlyArray<ClosureCore>): ClosureCore[] {
  return list.map((r) => ({ id: r.id, date: r.date, reason: r.reason ?? null })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** 特別営業日 written (add or remove): core's WHOLE array replaces the list, as returned. */
export function applySpecialOpenDays(prev: SpecialCore[] | null, answer: WriteAnswer<SpecialCore[]>): SpecialCore[] | null {
  if (!answer.ok) return prev
  // ⚖ PKT-S31 R5 — the ONE home for order: core's list is committed sorted by date (presentation only;
  // the door still hands back core's data untouched).
  return answer.value.map((d) => ({ date: d.date, open: d.open, close: d.close })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

// ── ⚖ PKT-S30 P3-12 — ONE home for the store-days copy both sides print ──────────────────────────
// door-writes.ts (server) and SettingsScreen.tsx (client) both import these; neither restates them.
/** The 特別営業日 badge (R3/R8, the copy round's folded verdict). */
export const SPECIAL_OPEN_DAYS_BADGE = '臨時休業より優先'
/** The read-only line (R2 — the copy round's folded verdict). */
export const READ_ONLY_NOTE = '変更には本部の権限が必要です。'
/** ⚖ S35 B2 act 1 (S2) — a LIVE block's add/remove is already saved; the save bar is not its step.
 *  LABEL CHECK: the page's save button renders 「保存する」 (SettingsScreen), so the quote says that. */
export const LIVE_SAVE_LINE = '「追加」「取り消す」を押すとすぐ保存されるため、この画面の「保存する」を押す必要はありません。'
export const ADD_PENDING_LABEL = '追加中'
export const REMOVE_PENDING_LABEL = '取り消し中'
/** A write that did not land (core / tenant refusal, or no answer at all). */
export const GENERIC_FAIL_LINE = 'いまは保存できないため、時間をおいてもう一度保存してください（予定の一覧はこれまでのままです）。'
/** Validation lines the door (door-writes.ts MSG) and the OFF-world draft add both print. */
export const PICK_DATE_LINE = '日付を選んでください。'
export const PICK_TIME_LINE = '時刻を選んでください。'
export const OPEN_NOT_BEFORE_CLOSE_LINE = '閉店時刻は開店時刻より後にしてください。'
export const DUPLICATE_SPECIAL_LINE = 'その日はすでに特別営業日です'

/** ⚖ PKT-S30 F10 (lead's RUN 3 re-ruling R-A) — the OFF world (the practice door is off): 特別営業日
 *  gets EXACTLY 臨時休業's OFF behaviour — a page-local draft add/remove that counts as an unsaved
 *  change (settings.ts rowChanges) and 保存 commits locally (the page's demoSaveLine explains it).
 *  A draft row is `{ id: date, title, note: 'open〜close', open, close }` — the date is its identity,
 *  as it is core's (one 特別営業日 per date). `rows` UNCHANGED (a copy) on a refusal. */
export type SpecialDraftRow = { id: string; title: string; note: string; open?: string; close?: string }
export function addSpecialDraft(
  rows: ReadonlyArray<SpecialDraftRow>,
  rawDate: string,
  rawOpen: string,
  rawClose: string,
  titleOf: (iso: string) => string,
): { rows: SpecialDraftRow[]; error: string | null } {
  const date = rawDate.trim()
  const open = rawOpen.trim()
  const close = rawClose.trim()
  if (date === '') return { rows: [...rows], error: PICK_DATE_LINE }
  if (open === '' || close === '') return { rows: [...rows], error: PICK_TIME_LINE }
  if (open >= close) return { rows: [...rows], error: OPEN_NOT_BEFORE_CLOSE_LINE }
  if (rows.some((r) => r.id === date)) return { rows: [...rows], error: DUPLICATE_SPECIAL_LINE }
  const row: SpecialDraftRow = { id: date, title: titleOf(date), note: `${open}〜${close}`, open, close }
  const at = rows.findIndex((r) => r.id > date)
  return { rows: at === -1 ? [...rows, row] : [...rows.slice(0, at), row, ...rows.slice(at)], error: null }
}

/** ⚖ S34 act 0 — a 特別営業日 may close at midnight. The door already takes `24:00` (door-writes.ts
 *  CLOSE_TIME_RE) and the draft check above is a plain `open >= close` string compare, which `24:00`
 *  passes against any real open time — so no second pattern here. The native time field cannot type
 *  `24:00`, so a switch stands beside 閉店: ON → the close is `24:00`; OFF → the time field's own value,
 *  which stays in state while the switch is ON, so turning it OFF gives the previous value back. */
export const MIDNIGHT_CLOSE = '24:00'
export const CLOSE_AT_MIDNIGHT_LABEL = '24:00閉店'
export const MIDNIGHT_CLOSE_BOX_ARIA = '閉店 24:00'
export function specialCloseOf(closeAtMidnight: boolean, typedClose: string): string {
  return closeAtMidnight ? MIDNIGHT_CLOSE : typedClose
}

/** ⚖ PKT-S30 F12 — the badge rule's ONE home: a 特別営業日 badges when its date is ALSO a 臨時休業
 *  date — computed from the CLOSURES list, never from the special list (R3). settings-props.ts
 *  stamps `items[].badge` with it; the screen re-asks it after a live 臨時休業 write. */
export function specialDayBadge(date: string, closures: ReadonlyArray<{ date: string }>): string | null {
  return closures.some((c) => c.date === date) ? SPECIAL_OPEN_DAYS_BADGE : null
}
