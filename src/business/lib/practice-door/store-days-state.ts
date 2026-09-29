// ⚖ PKT-S30 F2 (m6 + m15) — the ONE home of how 設定's 臨時休業・特別営業日 lists change after a
// write. Pure: no imports, no I/O, safe on both sides of the client boundary. SettingsScreen.tsx's
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
