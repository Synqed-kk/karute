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
/** ⚖ PKT-S30 F10 — the OFF world (the practice door is off): 特別営業日 has no local draft to add to,
 *  so its 追加 says so instead of doing nothing. Register = the page's own OFF-world line
 *  「保存はこの画面の中だけに反映されます（実データ接続後に本保存）。」 (settings-props.ts demoSaveLine). */
export const SPECIAL_OFF_WORLD_LINE = 'この画面では特別営業日を追加できません（実データ接続後に追加できます）。'

/** ⚖ PKT-S30 F12 — the badge rule's ONE home: a 特別営業日 badges when its date is ALSO a 臨時休業
 *  date — computed from the CLOSURES list, never from the special list (R3). settings-props.ts
 *  stamps `items[].badge` with it; the screen re-asks it after a live 臨時休業 write. */
export function specialDayBadge(date: string, closures: ReadonlyArray<{ date: string }>): string | null {
  return closures.some((c) => c.date === date) ? SPECIAL_OPEN_DAYS_BADGE : null
}
