'use client'

// 設定→メニュー — the service catalog (menu-catalog plan §3, PR-3b).
// ACTIVE rows are pressable and open the editor; RETIRED rows are NOT — their
// one action is 再開, and a pressable retired row would both nest buttons and
// open an editor whose footer offers メニューを停止… on an already-stopped menu.
//
// Order is CORE's order (category_display_order, display_order, created_at) —
// no client re-sort. The one deliberate client choice: menus with no category
// group under 未分類, rendered LAST.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import type { Menu } from '@synqed-kk/client'

import { Button } from '@/components/ui/button'
import { reactivateMenu } from '@/actions/menus'
import type { StoreRow } from '@/actions/stores'
import { MenuFormDialog, type MenuFormMode } from './menus/MenuFormDialog'
import { MenuConfirmDialog } from './menus/MenuConfirmDialog'

// Same helper shape as TicketPackCard.tsx:38 — a two-line local, not a shared
// module (one other caller, different namespace).
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

/** min null → the single list price; otherwise the honest band (plan §3). */
function priceLabel(menu: Menu): string {
  return menu.price_min_amount == null
    ? yen(menu.price_list_amount)
    : `${yen(menu.price_min_amount)}–${yen(menu.price_list_amount)}`
}

/** Sentinel key for the blank-category bucket. A real category is trimmed and
 *  non-empty by construction below, so '' can never collide with one — unlike
 *  the TRANSLATED 未分類 label, which a staff member can legitimately type as
 *  a real category name (duplicate React key, two groups indistinguishable in
 *  intent). Translated at render time instead. */
const UNCATEGORIZED = ''

/** Category buckets in first-appearance order (Map preserves insertion =
 *  core's order). The blank-category bucket is moved to the END and rendered
 *  under 未分類 — the sole client-side reordering in this list. A genuine
 *  未分類 category keeps its core position: two same-labeled headers is
 *  core-data truth, not something this list should hide. */
function groupByCategory(menus: Menu[]): [string, Menu[]][] {
  const groups = new Map<string, Menu[]>()
  for (const menu of menus) {
    const key = menu.category?.trim() || UNCATEGORIZED
    const bucket = groups.get(key)
    if (bucket) bucket.push(menu)
    else groups.set(key, [menu])
  }
  const blank = groups.get(UNCATEGORIZED)
  groups.delete(UNCATEGORIZED)
  const ordered: [string, Menu[]][] = [...groups]
  if (blank) ordered.push([UNCATEGORIZED, blank])
  return ordered
}

// Quiet NEUTRAL chip (StoresSection's neutral badge recipe) — a chip is not
// pressable, so no accent: the one-way accent law reserves saturated blue for
// things a user can press.
const CHIP =
  'inline-flex h-5 items-center rounded-full bg-muted px-1.5 text-[10px] font-medium text-foreground/70 ring-1 ring-border/60'

/** Shared row box — the pressable ACTIVE row and the inert RETIRED one differ
 *  in their element, never in their metrics. */
const ROW = 'flex items-start justify-between gap-3 px-4 py-3'

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
  const [formMode, setFormMode] = useState<MenuFormMode>(null)
  const [reactivateTarget, setReactivateTarget] = useState<Menu | null>(null)
  const [reactivatePending, setReactivatePending] = useState(false)
  // Mirror the last target so the 100ms close animation keeps its copy instead
  // of snapping to 「」を再開しますか？ — MenuFormDialog.tsx:60-63, same reason.
  const [lastReactivate, setLastReactivate] = useState<Menu | null>(null)
  if (reactivateTarget !== null && reactivateTarget !== lastReactivate)
    setLastReactivate(reactivateTarget)
  /** '' = 全店舗. A store id filters to that store's menus PLUS the all-store
   *  ones, because an all-store menu is bookable there too. */
  const [storeFilter, setStoreFilter] = useState('')

  const allActive = menus?.filter((m) => m.active) ?? []
  const allRetired = menus?.filter((m) => !m.active) ?? []
  // A catalog with only retired menus is NOT empty — 「まだありません」 is for a
  // business that has never registered a menu.
  const catalogEmpty = allActive.length === 0 && allRetired.length === 0
  const inFilter = (m: Menu) =>
    storeFilter === '' || m.store_id === storeFilter || m.store_id === null
  const active = allActive.filter(inFilter)
  const retired = allRetired.filter(inFilter)
  const groups = groupByCategory(active)
  // One store → the select would be a control with one real answer. No dead
  // chrome for a single-store business.
  const showFilter = menus !== null && !catalogEmpty && stores.length >= 2
  const showCreate = menus !== null && !catalogEmpty

  /** 再開. No alive-ref machinery at section level (unlike the dialog): the
   *  section outlives the await on every real path — it is the tab body, not a
   *  dismissible surface — and a setState after an unmount is a React-18
   *  no-op, not a warning. */
  async function reactivate(menu: Menu) {
    setReactivatePending(true)
    const res = await reactivateMenu(menu.id)
    setReactivatePending(false)
    // Closes either way: the confirm has nothing left to hold once the answer
    // is in, and a failure is reported by the toast, not by a stuck dialog.
    setReactivateTarget(null)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    // No client refresh: reactivateMenu revalidatePath('/settings')s.
    toast.success(t('form.reactivated'))
  }

  function storeChip(menu: Menu): string | null {
    if (!menu.store_id) return null
    return stores.find((s) => s.id === menu.store_id)?.name ?? t('storeScoped')
  }

  function row(menu: Menu, isRetired: boolean) {
    const store = storeChip(menu)
    const body = (
      // Spans, not divs: the ACTIVE row's root is a <button>, whose content
      // model is phrasing only (PostSessionResolutionDialog.tsx:201-210's
      // recipe). Flex items are blockified either way, so the metrics are
      // identical for the retired row's div root.
      <>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
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
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          <span
            className={`text-[14px] tabular-nums ${isRetired ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {priceLabel(menu)}
          </span>
          {/* 再開 sits after the price (mock ② :426). Outline, not the solid
           *  accent: reviving a stopped menu is a quiet correction, and the
           *  card's own commit action is the header CTA. */}
          {isRetired && (
            <Button variant="outline" size="sm" onClick={() => setReactivateTarget(menu)}>
              {t('reactivate')}
            </Button>
          )}
        </span>
      </>
    )
    // Retired rows stay DIVs — see the file-top note. The 再開 button inside
    // one is the only thing to press there.
    if (isRetired)
      return (
        <div key={menu.id} className={ROW}>
          {body}
        </div>
      )
    // Whole-row pressable, TranscriptSection.tsx:29's recipe (same px-4 py-3
    // row inside a card). Neutral wash on hover, never accent — the row is a
    // pressable, not a selected state.
    return (
      <button
        key={menu.id}
        type="button"
        onClick={() => setFormMode({ kind: 'edit', menu })}
        className={`${ROW} w-full text-left transition-colors hover:bg-muted/50`}
      >
        {body}
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {/* While the catalog is empty the empty state's CTA OWNS create (§3 R2),
       *  so the header button is suppressed — never two ways to start. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-foreground">{t('label')}</h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('description')}</p>
        </div>
        {showCreate && (
          <Button className="shrink-0" onClick={() => setFormMode({ kind: 'create' })}>
            {t('addMenu')}
          </Button>
        )}
      </div>

      {showFilter && (
        // Plain native select (mock :247-252) — the settings native-select
        // idiom (StoreFormDialog.tsx:136) at the mock's 160px, minus
        // appearance-none so the platform keeps drawing the chevron the mock
        // shows (the full-width selects that drop it are labelled fields; a
        // bare filter box would read as a text input).
        <select
          value={storeFilter}
          onChange={(e) => setStoreFilter(e.target.value)}
          aria-label={t('form.store')}
          className="w-[160px] rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">{t('form.allStores')}</option>
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {menus === null ? (
        <p className="text-[13px] text-muted-foreground">{t('loadError')}</p>
      ) : catalogEmpty ? (
        <div className="py-6 text-center">
          <p className="text-[13px] text-muted-foreground">{t('empty')}</p>
          <Button className="mt-3" onClick={() => setFormMode({ kind: 'create' })}>
            {t('addMenu')}
          </Button>
        </div>
      ) : active.length === 0 && retired.length === 0 ? (
        // The FILTER emptied a real catalog — never the 「まだありません」 state.
        <p className="py-6 text-center text-[13px] text-muted-foreground">{t('filterEmpty')}</p>
      ) : (
        <>
          {active.length > 0 && (
            <div className="overflow-hidden rounded-xl bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
              {groups.map(([category, rows]) => (
                <div key={category}>
                  <div className="bg-muted/30 px-4 py-1.5 text-[11px] font-medium text-muted-foreground">
                    {category === UNCATEGORIZED ? t('uncategorized') : category}
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

      {/* Both dialogs live at the section root (StoresSection.tsx:240-246's
       *  idiom) — a dialog mounted inside a row would die with the row the
       *  write it started re-renders away. The editor gets the UNFILTERED
       *  catalog: the store filter narrows the list, never the category
       *  vocabulary or the 表示順 default. */}
      <MenuFormDialog
        mode={formMode}
        catalog={menus ?? []}
        stores={stores}
        onClose={() => setFormMode(null)}
      />
      <MenuConfirmDialog
        open={reactivateTarget !== null}
        title={t('form.reactivateTitle', { name: lastReactivate?.name ?? '' })}
        body={t('form.reactivateBody')}
        confirmLabel={t('form.reactivateConfirm')}
        pending={reactivatePending}
        onCancel={() => setReactivateTarget(null)}
        onConfirm={() => {
          if (reactivateTarget) void reactivate(reactivateTarget)
        }}
      />
    </div>
  )
}
