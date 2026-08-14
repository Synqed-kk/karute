'use client'

// 設定→メニュー — the READ-ONLY service catalog (menu-catalog plan §3, PR-2).
// Rows are INERT this slice: the editor dialog lands in PR-3, so nothing here
// is pressable except the 停止中 disclosure — a row that looked pressable and
// did nothing is the same dead affordance the text-only empty state avoids.
//
// Order is CORE's order (category_display_order, display_order, created_at) —
// no client re-sort. The one deliberate client choice: menus with no category
// group under 未分類, rendered LAST.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import type { Menu } from '@synqed-kk/client'
import type { StoreRow } from '@/actions/stores'

// Same helper shape as TicketPackCard.tsx:38 — a two-line local, not a shared
// module (one other caller, different namespace).
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/** min null → the single list price; otherwise the honest band (plan §3). */
function priceLabel(menu: Menu): string {
  return menu.price_min_amount == null
    ? yen(menu.price_list_amount)
    : `${yen(menu.price_min_amount)}–${yen(menu.price_list_amount)}`
}

/** Category buckets in first-appearance order (Map preserves insertion =
 *  core's order). The blank-category bucket is moved to the END and rendered
 *  under 未分類 — the sole client-side reordering in this list. */
function groupByCategory(menus: Menu[], uncategorizedLabel: string): [string, Menu[]][] {
  const groups = new Map<string, Menu[]>()
  for (const menu of menus) {
    const key = menu.category?.trim() || ''
    const bucket = groups.get(key)
    if (bucket) bucket.push(menu)
    else groups.set(key, [menu])
  }
  const blank = groups.get('')
  groups.delete('')
  const ordered: [string, Menu[]][] = [...groups]
  if (blank) ordered.push([uncategorizedLabel, blank])
  return ordered
}

// Quiet NEUTRAL chip (StoresSection's neutral badge recipe) — a chip is not
// pressable, so no accent: the one-way accent law reserves saturated blue for
// things a user can press.
const CHIP =
  'inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-foreground/70 ring-1 ring-border/60'

interface MenusSectionProps {
  /** null = the server read FAILED. [] = a genuinely empty catalog. The two
   *  never render the same thing — an error must never read as
   *  「メニューがまだありません」 (plan §3 data honesty). */
  menus: Menu[] | null
  /** Resolves a store-scoped menu's chip to the store's NAME. Empty for a
   *  viewer without stores.viewAll → the chip falls back to a generic label. */
  stores: StoreRow[]
}

export function MenusSection({ menus, stores }: MenusSectionProps) {
  const t = useTranslations('settings.menus')
  const [retiredOpen, setRetiredOpen] = useState(false)

  const active = menus?.filter((m) => m.active) ?? []
  const retired = menus?.filter((m) => !m.active) ?? []
  const groups = groupByCategory(active, t('uncategorized'))

  function storeChip(menu: Menu): string | null {
    if (!menu.store_id) return null
    return stores.find((s) => s.id === menu.store_id)?.name ?? t('storeScoped')
  }

  function row(menu: Menu, isRetired: boolean) {
    const store = storeChip(menu)
    return (
      <div key={menu.id} className="flex items-start justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-[14px] font-medium ${isRetired ? 'text-muted-foreground' : 'text-foreground'}`}
            >
              {menu.name}
            </span>
            <span className="text-[12px] text-muted-foreground">
              {t('duration', { n: menu.duration_minutes })}
            </span>
            {isRetired && <span className={CHIP}>{t('retiredChip')}</span>}
            {store && <span className={CHIP}>{store}</span>}
            {!menu.online_visible && <span className={CHIP}>{t('onlineHidden')}</span>}
            {!menu.nomination_allowed && <span className={CHIP}>{t('nominationNo')}</span>}
          </div>
        </div>
        <div
          className={`shrink-0 text-[14px] tabular-nums ${isRetired ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {priceLabel(menu)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header row — no create button: the ＋メニューを追加 CTA lands in PR-3
       *  with the dialog it opens. */}
      <div className="min-w-0">
        <h3 className="text-[15px] font-semibold text-foreground">{t('label')}</h3>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{t('description')}</p>
      </div>

      {menus === null ? (
        <p className="text-[13px] text-muted-foreground">{t('loadError')}</p>
      ) : active.length === 0 && retired.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          {active.length > 0 && (
            <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
              {groups.map(([category, rows]) => (
                <div key={category}>
                  <div className="bg-muted/30 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
                    {category}
                  </div>
                  <div className="divide-y divide-black/5 dark:divide-white/5">
                    {rows.map((menu) => row(menu, false))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {retired.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setRetiredOpen((v) => !v)}
                aria-expanded={retiredOpen}
                className="inline-flex items-center gap-1 rounded-md py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronRight
                  className={`size-3.5 transition-transform ${retiredOpen ? 'rotate-90' : ''}`}
                  aria-hidden
                />
                {t('retiredGroup', { n: retired.length })}
              </button>
              {retiredOpen && (
                <div className="mt-2 overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
                  <div className="divide-y divide-black/5 dark:divide-white/5">
                    {retired.map((menu) => row(menu, true))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
