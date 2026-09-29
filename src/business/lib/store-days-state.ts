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

/** 特別営業日 written (add or remove): core's WHOLE array replaces the list, as returned. */
export function applySpecialOpenDays(prev: SpecialCore[] | null, answer: WriteAnswer<SpecialCore[]>): SpecialCore[] | null {
  if (!answer.ok) return prev
  return answer.value.map((d) => ({ date: d.date, open: d.open, close: d.close }))
}

// ── ⚖ PKT-S30 P3-12 — ONE home for the store-days copy both sides print ──────────────────────────
// door-writes.ts (server) and SettingsScreen.tsx (client) both import these; neither restates them.
/** The 特別営業日 badge (R3/R8, the copy round's folded verdict). */
export const SPECIAL_OPEN_DAYS_BADGE = '臨時休業より優先'
/** The read-only line (R2 — the copy round's folded verdict). */
export const READ_ONLY_NOTE = '変更には本部の権限が必要です。'
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

/** ⚖ PKT-S30 F12 — the badge rule's ONE home: a 特別営業日 badges when its date is ALSO a 臨時休業
 *  date — computed from the CLOSURES list, never from the special list (R3). settings-props.ts
 *  stamps `items[].badge` with it; the screen re-asks it after a live 臨時休業 write. */
export function specialDayBadge(date: string, closures: ReadonlyArray<{ date: string }>): string | null {
  return closures.some((c) => c.date === date) ? SPECIAL_OPEN_DAYS_BADGE : null
}
