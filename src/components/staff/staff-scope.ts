// ONE staff lens for the three list tabs (カルテ · 顧客 · 予約) — ⚖ S44.
//
// Every tab keeps the same state shape it always had ('all' | 'self' |
// <staffId>, StaffFilterKey) and its own home for it (カルテ/顧客 = client
// state + `?s=`, 予約 = the server's `?staff=`). What they SHARE is here:
//
//  1. resolveStaffScope — ⚖ Liam 9/27 01:56 「退職スタッフのリンク = 全員を表示」.
//     A saved/shared link, or a remembered pick, that names somebody the
//     current roster does not hold resolves to 'all' — the label AND the
//     filter together, so the list shows everyone and the control reads
//     全スタッフ. Never a label saying one thing while the filter does another,
//     never an empty list. 'self' needs a staff profile; without one it is
//     'all' too (parity with the old segment, which never offered 自分
//     without a self id). The RAW pick is kept by each caller, so a roster
//     or a profile that arrives later narrows again unchanged.
//
//  2. The remembered pick — ⚖ STAFF CONTROL 04:5x: the app remembers each
//     person's last staff pick per tab, so most days need zero taps.
//     Browser-only (localStorage), per person, per tab. NOTHING is written
//     to the database. Precedence: an explicit URL param (a shared link) >
//     the remembered pick > today's default ('all').
//
//     Keyed like the app's per-person precedent (src/business/lib/settings.ts
//     prefsKey: an ID, never a name; NO IDENTITY = NO PERSISTENCE — a viewer
//     the app cannot name gets today's default, never somebody else's row).

import { useLayoutEffect } from 'react'

export type StaffScope = 'all' | 'self' | (string & {})

export type StaffScopeTab = 'records' | 'customers' | 'appointments'

/** The one lens: what a raw pick means against the roster on screen. */
export function resolveStaffScope(
  raw: string | null | undefined,
  { selfStaffId, rosterIds }: { selfStaffId: string | null | undefined; rosterIds: readonly string[] },
): StaffScope {
  if (!raw || raw === 'all') return 'all'
  if (raw === 'self') return selfStaffId ? 'self' : 'all'
  return rosterIds.includes(raw) ? raw : 'all'
}

export const STAFF_SCOPE_KEY_BASE = 'karute:staffScope'

/** `karute:staffScope:<tab>:<operatorId>`, or null when the viewer has no id. */
export function staffScopeKey(tab: StaffScopeTab, operatorId: string | null | undefined): string | null {
  return operatorId ? `${STAFF_SCOPE_KEY_BASE}:${tab}:${operatorId}` : null
}

/** ⚠ A stored value is untrusted input: anything that is not a non-empty
 *  string reads as "nothing remembered". Whether it still names somebody is
 *  resolveStaffScope's job, at render, against the live roster. */
export function readRememberedStaffScope(
  tab: StaffScopeTab,
  operatorId: string | null | undefined,
): string | null {
  const key = staffScopeKey(tab, operatorId)
  if (!key || typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(key)
    return v && v.trim() ? v : null
  } catch {
    return null
  }
}

/** Written on a person's own pick only — never on a reset (a store switch)
 *  or a resolution (a departed staffer reading 全スタッフ). */
export function rememberStaffScope(
  tab: StaffScopeTab,
  operatorId: string | null | undefined,
  scope: string,
): void {
  const key = staffScopeKey(tab, operatorId)
  if (!key || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, scope)
  } catch {
    // Storage unavailable (private mode / quota): the pick still applies to
    // this screen; it simply does not outlive it.
  }
}

/** Precedence in one line: URL param > remembered > 'all'. */
export function pickInitialStaffScope(
  urlParam: string | null | undefined,
  remembered: string | null | undefined,
): string {
  return urlParam || remembered || 'all'
}

/**
 * Restores the remembered pick once, on mount, when the URL named none.
 *
 * A layout effect, not a lazy initial state: the web door server-renders
 * these lists, and the server has no localStorage — reading it during the
 * first render would hydrate a different tree than the server sent. On the
 * phone (client-only) the layout effect lands before the first paint.
 */
export function useRestoreStaffScope({
  tab,
  operatorId,
  urlParam,
  apply,
}: {
  tab: StaffScopeTab
  operatorId: string | null | undefined
  /** The explicit param this visit arrived with (null = none). */
  urlParam: string | null | undefined
  /** Called with the remembered pick when there is one and no URL param. */
  apply: (remembered: string) => void
}): void {
  useLayoutEffect(() => {
    if (urlParam) return
    const remembered = readRememberedStaffScope(tab, operatorId)
    if (remembered && remembered !== 'all') apply(remembered)
    // Mount-only by design: a later pick is the person's own, and a later
    // URL change is navigation — neither should be overridden by storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
