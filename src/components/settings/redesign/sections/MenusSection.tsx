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
import { ChevronDown, ChevronRight } from 'lucide-react'
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
  /** The stores this actor may WRITE menus for (settings/page.tsx resolves it
   *  from their scope): the store filter's options, the editor's pills, and
   *  the chip's NAME lookup. Another branch's menu isn't in here, so its chip
   *  falls back to the generic 店舗限定 label — the pre-existing degrade, now
   *  doing double duty as the no-leak path. */
  stores: StoreRow[]
  /** stores.viewAll. Gates the 全店舗 (store_id null) menus, which land in
   *  every branch's picker — src/actions/menus.ts refuses them without it. */
  canViewAllStores: boolean
}

export function MenusSection({ menus, stores, canViewAllStores }: MenusSectionProps) {
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
  // An invalid selection DIES instead of hibernating: the moment the select
  // couldn't exist (<2 stores, the same threshold as `showFilter` below) or the
  // store is gone, the STATE resets to 全店舗 — so a store that later returns
  // does not silently re-narrow the list (a filter nobody can see, or just
  // re-chose, must never come back on its own). Both halves are needed because
  // the two props are asymmetric by design (:78-79): stores can shrink to one
  // while menus still carries the OTHER store's scoped rows. Same render-phase
  // adjustment idiom as lastReactivate above — React re-renders synchronously
  // before commit, so no frame ever shows the stale filtering and every read
  // below can stay on raw `storeFilter`.
  if (storeFilter !== '' && !(stores.length >= 2 && stores.some((s) => s.id === storeFilter)))
    setStoreFilter('')

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

  /** 再開. The section CAN die mid-write: SettingsShell renders sections with a
   *  plain renderSection(activeTab) call (SettingsShell.tsx:395,420), so a tab
   *  switch — or backing out of the mobile drill — unmounts this component
   *  while the await is in flight. No alive-ref machinery all the same: the
   *  paired setStates land on an unmounted component, which React 18 makes a
   *  silent no-op (no warning, nothing to guard). The completion toast firing
   *  after the unmount is DELIBERATE, not a leak — it reports a write that
   *  genuinely landed server-side, and swallowing it would hide a real outcome
   *  from the person who started it.
   *
   *  The unconditional close and toast below are safe for the REPLACED-target
   *  case too, because the rows gate that case out of existence: 再開 is
   *  disabled while this runs (row(), below), so a confirm dismissed mid-write
   *  cannot be replaced by another menu's. Every reachable sequence therefore
   *  ends with either the confirm that started this write still open (closed
   *  here, correctly) or no confirm at all (nothing to close) — never a
   *  different menu's dialog slammed shut under someone's cursor. */
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

  /** Out-of-scope rows stay VISIBLE but lose every write affordance — the
   *  editor and 再開 alike, because both end in a refused write (⚖ Liam
   *  2026-08-17, enforced in src/actions/menus.ts). The catalog read is
   *  deliberately unchanged: a branch manager still sees the whole menu list,
   *  they just can't touch another branch's rows. */
  function canEdit(menu: Menu): boolean {
    // viewAll answers FIRST, exactly like the server clamp — never via the
    // store list, or a degraded/empty stores prop would lock an owner out of
    // their own catalog.
    if (canViewAllStores) return true
    return menu.store_id !== null && stores.some((s) => s.id === menu.store_id)
  }

  function row(menu: Menu, isRetired: boolean) {
    const store = storeChip(menu)
    const editable = canEdit(menu)
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
           *  card's own commit action is the header CTA.
           *
           *  Gated on the pending write, and THAT is the whole single-flight
           *  story — no in-flight ref needed. The confirm's X/ESC/backdrop stay
           *  live mid-write by the dismissal law, so an ungated row would let a
           *  staff member dismiss and open a SECOND menu's confirm, which the
           *  first write's completion would then slam shut while toasting
           *  再開しました beside the wrong name. With every row inert, no new
           *  target can be set mid-flight, so the only confirm open when a
           *  write resolves is the one that started it. */}
          {isRetired && editable && (
            <Button
              variant="outline"
              size="sm"
              disabled={reactivatePending}
              onClick={() => setReactivateTarget(menu)}
            >
              {t('reactivate')}
            </Button>
          )}
        </span>
      </>
    )
    // Retired rows stay DIVs — see the file-top note. The 再開 button inside
    // one is the only thing to press there. An out-of-scope ACTIVE row takes
    // the same inert root: with no editor to open, a pressable row would be a
    // button that does nothing.
    if (isRetired || !editable)
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
        // Native select (mock :247-252) — the settings native-select idiom
        // (StoreFormDialog.tsx:136) at the mock's 160px. appearance-none is the
        // law for every select in settings, and the mock's own chevron is
        // CUSTOM-drawn (settings-mocks.html:79-84 = appearance:none plus a
        // background-image arrow), never the platform's: WebKit hands a native
        // select its own capsule chrome and throws the border/bg/radius away,
        // and with no color-scheme signal that capsule can render light inside
        // a dark panel. Replacement arrow = the house recipe,
        // AuditLogSection.tsx:764-767.
        <div className="relative w-[160px]">
          <select
            value={storeFilter}
            onChange={(e) => setStoreFilter(e.target.value)}
            aria-label={t('form.store')}
            className="w-full appearance-none rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-[13px] focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">{t('form.allStores')}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <ChevronDown
            className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
        </div>
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
      ) : (
        <>
          {/* The FILTER left this store nothing BOOKABLE — never the
           *  「まだありません」 state. Said whenever the filtered ACTIVE list is
           *  empty, retired rows or not: a 停止中 menu cannot be booked, so the
           *  line is true either way, and without it a store whose only
           *  survivors are stopped shows nothing but a collapsed disclosure.
           *  Only ever under a filter — with 全店舗 selected an all-retired
           *  catalog stays disclosure-only (PR-2's settled ruling), and an
           *  unfiltered empty catalog is `catalogEmpty` above. */}
          {storeFilter !== '' && active.length === 0 && (
            <p className="py-6 text-center text-[13px] text-muted-foreground">{t('filterEmpty')}</p>
          )}

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
        canViewAllStores={canViewAllStores}
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
