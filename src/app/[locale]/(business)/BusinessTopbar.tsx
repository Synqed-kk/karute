'use client'

// The Business topbar — canon markup (fable-store-customers.html:461-464 plus
// the ◈ サンプルデータ honesty chip that fable-store-today.html:1722 carries).
// ⚖ L-4 keeps the chip and strips the mock harness: no 表示プレビュー picker,
// no 「サンプル・シナリオB」 text, no testdb anchor span.
//
// The breadcrumb is derived here rather than plumbed through every page:
// group / store / screen is exactly what the pathname and the store lens
// already say, and one derivation cannot drift from one of three pages.

import { usePathname, useSearchParams } from 'next/navigation'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ShellStore } from './BusinessSidebar'

/** The topbar's primary-action slot — canon's rightmost `btn primary`
 *  (fable-store-today.html:1725, 予約を作成).
 *
 *  The button belongs to the SHELL and the dialog it opens belongs to the
 *  SCREEN, so the two have to meet somewhere. They meet here: a screen
 *  registers a label + handler while it is mounted, the topbar renders the
 *  canon button, and a screen with no primary action leaves the slot empty.
 *  react-dom's createPortal is the other way to do this, and react-dom is off
 *  territory's import allowlist (business-isolation.test.ts) — widening it
 *  would mean editing a guard that lives outside territory. Context is the
 *  same result with the render runtime territory already has. */
interface TopbarAction {
  label: string
  onClick: () => void
}

const ActionSlot = createContext<{
  action: TopbarAction | null
  set: (a: TopbarAction | null) => void
}>({ action: null, set: () => {} })

/** Wraps the topbar AND the screen under it, so a screen can fill the slot. */
export function BusinessTopbarActionSlot({ children }: { children: ReactNode }) {
  const [action, set] = useState<TopbarAction | null>(null)
  return <ActionSlot.Provider value={{ action, set }}>{children}</ActionSlot.Provider>
}

/** Screen side. `onClick` is the effect's dependency, so pass a stable one
 *  (useCallback) — an inline arrow would re-register on every render. */
export function useTopbarAction(label: string, onClick: () => void) {
  const { set } = useContext(ActionSlot)
  useEffect(() => {
    // An EMPTY label leaves the slot empty. A screen whose primary action only
    // exists in some states (スタッフ・シフト's 欠勤内容を確認, which needs an
    // absence to open) can then say so without a conditional hook, and the
    // topbar never renders a button with no words on it.
    if (!label) {
      set(null)
      return
    }
    set({ label, onClick })
    return () => set(null)
  }, [set, label, onClick])
}

/** Screen segment → its canon breadcrumb leaf. Nav labels live in the sidebar;
 *  this is the crumb vocabulary, which differs on 予約一覧. */
const CRUMB: Record<string, string> = {
  today: '今日の運営',
  reservations: '予約一覧',
  customers: '顧客',
  inbox: '受信トレイ',
  register: '売上・レジ',
  analytics: '売上分析',
  shifts: 'スタッフ・シフト',
  karute: 'カルテ',
  recording: '録音',
  settings: '予約と確保',
}

/** …and its GROUP, for the crumb's first word. The rail already groups every
 *  item (`NAV`, BusinessSidebar); every room built so far happens to live under
 *  店舗フロア, which is why that word was a literal. ⚖ Liam 9/1 — the settings
 *  room is the first that does NOT, so the crumb reads the group instead of
 *  claiming one. A segment with no entry keeps the default, so no existing
 *  room's crumb moves a byte. */
const GROUP: Record<string, string> = {
  settings: '設定',
}

export function BusinessTopbar({ stores, syncLabel }: { stores: ShellStore[]; syncLabel: string }) {
  const pathname = usePathname()
  const search = useSearchParams()
  const { action } = useContext(ActionSlot)

  const segment = pathname.split('/business/')[1]?.split('/')[0] ?? ''
  const leaf = CRUMB[segment] ?? '顧客'
  // No ?store= opens on the operator's own store, matching the sidebar's
  // switcher since すべての店舗 left it (⚖ Liam 2026-08-20).
  const store = stores.find((s) => s.id === search.get('store')) ?? stores[0]

  return (
    <header className="topbar">
      <div className="crumb">
        {GROUP[segment] ?? '店舗フロア'} / {store ? store.name : 'すべての店舗'} / <b>{leaf}</b>
      </div>
      <div className="top-actions">
        <span className="honesty" role="note" aria-label="サンプルデータ — 実データではありません">
          ◈ サンプルデータ
        </span>
        <span className="sync">{syncLabel}</span>
        {/* 操作履歴 has no screen and no canon client transition — disabled with
            the standing hint, never a button that pretends (L-7). */}
        <button className="btn" type="button" disabled title="見本データのため実行できません">
          操作履歴
        </button>
        {/* Canon order ends here: ◈サンプルデータ · Reserve同期 · 操作履歴 ·
            予約を作成. Empty on a screen that registers nothing. */}
        {action && (
          <button className="btn primary" type="button" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </header>
  )
}
