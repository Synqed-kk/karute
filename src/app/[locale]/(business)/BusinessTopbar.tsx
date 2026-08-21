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
import type { ShellStore } from './BusinessSidebar'

/** Screen segment → its canon breadcrumb leaf. Nav labels live in the sidebar;
 *  this is the crumb vocabulary, which differs on 予約一覧. */
const CRUMB: Record<string, string> = {
  today: '今日の運営',
  reservations: '予約一覧',
  customers: '顧客',
}

export function BusinessTopbar({ stores, syncLabel }: { stores: ShellStore[]; syncLabel: string }) {
  const pathname = usePathname()
  const search = useSearchParams()

  const segment = pathname.split('/business/')[1]?.split('/')[0] ?? ''
  const leaf = CRUMB[segment] ?? '顧客'
  // No ?store= opens on the operator's own store, matching the sidebar's
  // switcher since すべての店舗 left it (⚖ Liam 2026-08-20).
  const store = stores.find((s) => s.id === search.get('store')) ?? stores[0]

  return (
    <header className="topbar">
      <div className="crumb">
        店舗フロア / {store ? store.name : 'すべての店舗'} / <b>{leaf}</b>
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
      </div>
    </header>
  )
}
