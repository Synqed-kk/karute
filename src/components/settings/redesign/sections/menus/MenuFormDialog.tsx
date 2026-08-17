'use client'

// 設定→メニュー の作成／編集ダイアログ (menu-catalog plan §3, PR-3). Shared
// create+edit body — StoreFormDialog's idiom (mode prop, useState per field,
// disabled footer). Visual law = the signed mocks ①b / ⑤.
//
// The server actions are the authority: they re-parse with the same
// menuSchema/menuBandError this file imports, so the client checks below are
// live feedback, never the gate.

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { ChevronRight } from 'lucide-react'
import type { Menu } from '@synqed-kk/client'

import { Button } from '@/components/ui/button'
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dialog,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { createMenu, retireMenu, updateMenu } from '@/actions/menus'
import { menuSchema, menuBandError, type MenuFormInput } from '@/lib/validations/menu'
import type { StoreRow } from '@/actions/stores'
import { MenuConfirmDialog } from './MenuConfirmDialog'

export type MenuFormMode = null | { kind: 'create' } | { kind: 'edit'; menu: Menu }

interface MenuFormDialogProps {
  mode: MenuFormMode
  /** The catalog behind the list — category suggestions and the CREATE 表示順
   *  default are both derived from it (core has no category entity). */
  catalog: Menu[]
  /** The stores this actor may write menus for — the scope pills. */
  stores: StoreRow[]
  /** stores.viewAll: without it the 全店舗 pill is not offered, because
   *  src/actions/menus.ts refuses an all-store write from a branch actor. */
  canViewAllStores: boolean
  onClose: () => void
}

/** The submitted shape of a menu as it stands today — the EDIT pristine
 *  comparison's baseline. Trimmed exactly like the form's own values so a
 *  stored name with stray whitespace doesn't read as an unsaved change. */
function currentInput(menu: Menu): MenuFormInput {
  return {
    name: menu.name.trim(),
    category: menu.category?.trim() ?? '',
    duration_minutes: menu.duration_minutes,
    price_list_amount: menu.price_list_amount,
    price_min_amount: menu.price_min_amount,
    store_id: menu.store_id,
    online_visible: menu.online_visible,
    display_order: menu.display_order,
  }
}

export function MenuFormDialog({
  mode,
  catalog,
  stores,
  canViewAllStores,
  onClose,
}: MenuFormDialogProps) {
  // Mirror the last non-null mode so the close animation doesn't snap to blank
  // copy — StoreFormDialog.tsx:58-66's pattern, same reason.
  const [lastMode, setLastMode] = useState<NonNullable<MenuFormMode> | null>(null)
  if (mode !== null && mode !== lastMode) setLastMode(mode)
  // That mirror keeps the body MOUNTED after close, so the key has to carry an
  // open counter too: without it, reopening the same menu resurrects the
  // abandoned draft of a cancelled edit — with 保存 already enabled, because
  // the pristine baseline is the stored row. Cancel means discard.
  const [open, setOpen] = useState(false)
  const [openSeq, setOpenSeq] = useState(0)
  if ((mode !== null) !== open) {
    setOpen(mode !== null)
    if (mode !== null) setOpenSeq((n) => n + 1)
  }
  const displayMode = mode ?? lastMode

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && onClose()}>
      {displayMode !== null && (
        <MenuFormBody
          key={`${openSeq}-${displayMode.kind === 'edit' ? `edit-${displayMode.menu.id}` : 'create'}`}
          menu={displayMode.kind === 'edit' ? displayMode.menu : null}
          active={mode !== null}
          catalog={catalog}
          stores={stores}
          canViewAllStores={canViewAllStores}
          onClose={onClose}
        />
      )}
    </Dialog>
  )
}

function MenuFormBody({
  menu,
  active,
  catalog,
  stores,
  canViewAllStores,
  onClose,
}: {
  menu: Menu | null
  /** This body is the OPEN dialog — false once its mode closed but the mirror
   *  kept it mounted for the exit animation. */
  active: boolean
  catalog: Menu[]
  stores: StoreRow[]
  canViewAllStores: boolean
  onClose: () => void
}) {
  const t = useTranslations('settings.menus.form')
  const tMenus = useTranslations('settings.menus')

  const [name, setName] = useState(menu?.name ?? '')
  const [category, setCategory] = useState(menu?.category ?? '')
  const [duration, setDuration] = useState(menu ? String(menu.duration_minutes) : '')
  const [price, setPrice] = useState(menu ? String(menu.price_list_amount) : '')
  const [minPrice, setMinPrice] = useState(
    menu?.price_min_amount == null ? '' : String(menu.price_min_amount),
  )
  // CREATE defaults to 全店舗 (null) — except for an actor who may not write
  // one, whose default is their FIRST store: the old null default would hand
  // them a form whose 保存 the server refuses before they touched anything.
  const [storeId, setStoreId] = useState<string | null>(
    menu ? menu.store_id : canViewAllStores ? null : (stores[0]?.id ?? null),
  )
  const [onlineVisible, setOnlineVisible] = useState(menu?.online_visible ?? true)
  const [order, setOrder] = useState(menu ? String(menu.display_order) : '')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [widenOpen, setWidenOpen] = useState(false)
  // Mutually exclusive with widenOpen BY CONSTRUCTION — widen only fires from
  // inside save(), retire only from the footer button that save() never
  // reaches. No coordination code.
  const [retireOpen, setRetireOpen] = useState(false)

  // Only the footer buttons are gated while a write is in flight — ESC, an
  // outside click and the X still dismiss. The write lands server-side either
  // way (and revalidatePath refreshes the data); what must never happen is a
  // dismissed form's closure driving dialog UI. TWO stale shapes, so two
  // guards: dismissed-then-reopened UNMOUNTS this body (alive), while
  // dismissed-and-left-closed leaves it mounted behind the exit animation and
  // only `active` goes false. No open dialog → no dialog UI effects.
  const alive = useRef(true)
  // Setup RE-ARMS the flag. StrictMode (on by default in dev) mounts, unmounts
  // and remounts every component: a cleanup-only effect would run that cleanup
  // once and leave alive false forever, so every dev-mode save would return
  // early after its await — no toast, no close, 保存 stuck inert. Production
  // never double-invokes, which is exactly why no gate would have caught it.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  // Mirrored in an EFFECT, not assigned during render: the repo's
  // react-hooks/refs rule rejects touching ref.current in the render pass. A
  // passive effect flushes in a scheduled task, so it lands almost always
  // before a real network write resolves; the residual window is accepted —
  // closing it would take the render-phase assignment the lint rule forbids.
  // (Its own effect — sharing one with `alive` above would run that cleanup on
  // every `active` change and kill a live body.)
  const activeRef = useRef(active)
  useEffect(() => {
    activeRef.current = active
  }, [active])

  // Distinct categories in encounter order (Set preserves insertion) — the
  // suggestion chips. Core has no category entity: this IS the vocabulary.
  const categories = [
    ...new Set(catalog.map((m) => m.category?.trim()).filter((c): c is string => !!c)),
  ]

  // CREATE: the next slot in the chosen category (its max + 10), so a new menu
  // lands at the bottom of its own group instead of colliding at 0. The -10
  // seed makes an empty/new category start at 0. Offered as the field's
  // placeholder — leaving 表示順 blank saves exactly this number.
  const defaultOrder = menu
    ? menu.display_order
    : Math.max(
        -10,
        ...catalog
          .filter((m) => (m.category?.trim() ?? '') === category.trim())
          .map((m) => m.display_order),
      ) + 10

  const input: MenuFormInput = {
    name: name.trim(),
    category: category.trim(),
    duration_minutes: Number(duration),
    price_list_amount: Number(price),
    // Cleared floor → null (fixed price), never 0: Number('') is 0, which
    // would silently publish a ¥0–list band.
    price_min_amount: minPrice.trim() === '' ? null : Number(minPrice),
    store_id: storeId,
    online_visible: onlineVisible,
    display_order: order.trim() === '' ? defaultOrder : Number(order),
  }

  // EDIT: 保存 stays inert until something actually differs — the source-level
  // suppression of empty-detail settings.menu_update audit rows (Liam 8/15).
  // CREATE: inert until the three required fields carry a value.
  const base = menu ? currentInput(menu) : null
  const changed =
    base === null ||
    (Object.keys(input) as (keyof MenuFormInput)[]).some((k) => input[k] !== base[k])
  const canSave =
    name.trim() !== '' && duration.trim() !== '' && price.trim() !== '' && changed && !pending

  async function save(wideningConfirmed = false) {
    const parsed = menuSchema.safeParse(input)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message)
      return
    }
    const band = menuBandError(input)
    if (band) {
      toast.error(band)
      return
    }
    // Widening a store-scoped menu to 全店舗 changes who can book it, so it is
    // confirmed before the write (mock ②b). ONLY that transition: create,
    // store→store and null→store all save straight through.
    if (menu && menu.store_id !== null && input.store_id === null && !wideningConfirmed) {
      setWidenOpen(true)
      return
    }
    setPending(true)
    const res = menu ? await updateMenu(menu.id, input) : await createMenu(input)
    if (!alive.current || !activeRef.current) return
    setPending(false)
    // The ②b confirm stays up for the whole write (its own buttons inert), so
    // the pending state sits on the button that was pressed; it closes either
    // way once the answer is in.
    setWidenOpen(false)
    // Failure keeps the dialog open with every value intact (§3) — the staff
    // member fixes one field and presses 保存 again.
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    // No client refresh: every menu action revalidatePath('/settings')s, so the
    // route re-renders off the action's own response (src/actions/menus.ts).
    toast.success(t('saved'))
    onClose()
  }

  /** 停止 — save()'s guard idiom to the letter (same two stale shapes, same
   *  reasons): a dismissed body must never toast or force-close the dialog
   *  that replaced it. Retiring is reversible (再開 in the list), so the
   *  confirm's commit button stays the accent, never destructive red. */
  async function retire() {
    if (!menu) return
    setPending(true)
    const res = await retireMenu(menu.id)
    if (!alive.current || !activeRef.current) return
    setPending(false)
    // The confirm holds through the write (its own buttons inert) and closes
    // either way once the answer is in — a failure leaves the editor open with
    // every value intact, exactly like a failed 保存.
    setRetireOpen(false)
    if ('error' in res) {
      toast.error(res.error)
      return
    }
    toast.success(t('retired'))
    onClose()
  }

  const scopedStoreName =
    stores.find((s) => s.id === menu?.store_id)?.name ?? tMenus('storeScoped')

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{menu ? t('editTitle') : t('createTitle')}</DialogTitle>
        <DialogDescription>{menu ? menu.name : t('createSubtitle')}</DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <section className="space-y-3">
          <GroupLabel>{t('groupBasic')}</GroupLabel>
          <Field label={t('name')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label={t('category')}>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          {/* Suggestion chips sit OUTSIDE the label (a label names exactly one
           *  control) — tapping one fills the free-text field. */}
          {categories.length > 0 && (
            <div className="-mt-1.5 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className="rounded-full border border-border bg-background px-2.5 py-[3px] text-[11px] text-foreground transition-colors hover:bg-muted"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {/* Mock widths: 160px on the 393 frame, 200px at 1280. */}
          <Field label={t('duration')} required className="max-w-[160px] sm:max-w-[200px]">
            <div className="relative">
              <Input
                value={duration}
                inputMode="numeric"
                onChange={(e) => setDuration(e.target.value)}
                className="pr-8"
              />
              <Affix className="right-2.5">{t('minuteSuffix')}</Affix>
            </div>
          </Field>
        </section>

        <section className="space-y-3">
          <GroupLabel>{t('groupPrice')}</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('price')} required>
              <Money value={price} onChange={setPrice} />
            </Field>
            <Field label={t('minPrice')}>
              <Money value={minPrice} onChange={setMinPrice} />
              <Helper>{t('minPriceHelp')}</Helper>
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="inline-flex items-center gap-1 rounded-md py-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronRight
              className={`size-3.5 transition-transform ${detailsOpen ? 'rotate-90' : ''}`}
              aria-hidden
            />
            {detailsOpen ? t('groupDetails') : t('groupDetailsClosed')}
          </button>
          {detailsOpen && (
            <>
              {/* Single-select store scope — the audit-log filter-pill IA
               *  (mock ⑤). 全店舗 is store_id null; core has no multi-store
               *  subset, so this is one pill or the other. A plain group, not
               *  a <label>: a label may only name one control.
               *
               *  The 全店舗 pill needs stores.viewAll (⚖ Liam 2026-08-17): an
               *  all-store menu lands in every branch's picker, so a
               *  branch-scoped actor is REFUSED one by src/actions/menus.ts —
               *  the old "disclose it instead of blocking it" note is dead,
               *  the server is the answer now. Not offering it here is only
               *  so the form can't compose a save the server will reject; the
               *  same reason its CREATE default is the first store above.
               *
               *  Still HIDDEN whole on an empty stores prop, viewAll or not:
               *  with no store names to read, changing scope would be blind.
               *  For a viewAll actor that is the degraded store read, and the
               *  note at the bottom of the body discloses the all-stores
               *  default it leaves in place. */}
              {stores.length > 0 && (
                <div role="group" aria-label={t('store')}>
                  <span className="mb-1 block text-xs font-medium text-foreground">
                    {t('store')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      ...(canViewAllStores
                        ? [{ id: null as string | null, name: t('allStores') }]
                        : []),
                      ...stores,
                    ].map((s) => (
                      <button
                        key={s.id ?? 'all'}
                        type="button"
                        aria-pressed={storeId === s.id}
                        onClick={() => setStoreId(s.id)}
                        className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                          storeId === s.id
                            ? 'border-primary bg-primary/8 text-primary'
                            : 'border-border text-foreground/80 hover:bg-muted'
                        }`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="block text-xs font-medium text-foreground">
                    {t('onlineVisible')}
                  </span>
                  <Helper>{t('onlineVisibleHelp')}</Helper>
                </div>
                {/* PacksSection.tsx:29-59's switch recipe (anchored knob — an
                 *  un-anchored one lands half outside the pill on iOS), in
                 *  the mock's accent rather than its emerald: mock ⑤ paints
                 *  the ON track with the accent, and a switch track is the
                 *  pressable itself. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={onlineVisible}
                  aria-label={t('onlineVisible')}
                  onClick={() => setOnlineVisible((v) => !v)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                    onlineVisible ? 'bg-primary' : 'bg-muted-foreground/30'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${
                      onlineVisible ? 'right-0.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
              <Field label={t('order')} className="max-w-[120px]">
                <Input
                  value={order}
                  inputMode="numeric"
                  placeholder={String(defaultOrder)}
                  onChange={(e) => setOrder(e.target.value)}
                />
              </Field>
              <Helper>{t('orderHelp')}</Helper>
            </>
          )}
        </section>

        {/* EDIT only: in CREATE there is no existing booking to reassure about. */}
        {menu && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] leading-relaxed text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
            {t('changeScope')}
          </p>
        )}
        {/* CREATE with no visible stores: the 店舗 pills above are hidden, so
         *  the all-stores default would otherwise be published silently. Same
         *  slot and same infowash as the EDIT line — and OUTSIDE 詳細 on
         *  purpose: a scope nobody chose is not something to go looking for.
         *  viewAll-only: to a branch actor the sentence would be a promise the
         *  server breaks (it refuses their all-store write outright). */}
        {!menu && stores.length === 0 && canViewAllStores && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] leading-relaxed text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
            {t('createAllStoresNote')}
          </p>
        )}
      </div>

      {/* CREATE keeps the plain right-aligned pair — justify-between with a
       *  single child would push it to the left edge. */}
      <DialogFooter className={menu ? 'sm:justify-between' : 'sm:justify-end'}>
        {/* EDIT only (mock ① :379): a menu that does not exist yet cannot be
         *  stopped. Quiet ghost, not destructive red — 停止 is reversible from
         *  the list, and the one-way accent law lets a pressable be quieter
         *  than the accent. */}
        {menu && (
          <Button variant="ghost" onClick={() => setRetireOpen(true)} disabled={pending}>
            {t('retireAction')}
          </Button>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t('cancel')}
          </Button>
          {/* An inert 保存 is GRAY, never a faded accent — the signed mock states
           *  the rule for this exact state (settings-mocks.html:51-52,
           *  #e5e7eb / #9ca3af = gray-200 / gray-400 to the byte). opacity-100
           *  defeats the shared Button's disabled fade; the shared component
           *  itself stays untouched. */}
          <Button
            onClick={() => void save()}
            disabled={!canSave}
            className="disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-100 dark:disabled:bg-white/10 dark:disabled:text-white/40"
          >
            {t('save')}
          </Button>
        </div>
      </DialogFooter>

      <MenuConfirmDialog
        open={widenOpen}
        title={t('widenTitle', { name: input.name })}
        body={t('widenBody', { store: scopedStoreName })}
        confirmLabel={t('widenConfirm')}
        pending={pending}
        onCancel={() => setWidenOpen(false)}
        onConfirm={() => void save(true)}
      />

      {menu && (
        <MenuConfirmDialog
          open={retireOpen}
          title={t('retireTitle', { name: menu.name })}
          body={t('retireBody')}
          confirmLabel={t('retireConfirm')}
          pending={pending}
          onCancel={() => setRetireOpen(false)}
          onConfirm={() => void retire()}
        />
      )}
    </DialogContent>
  )
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[12px] font-semibold text-muted-foreground">{children}</div>
}

function Helper({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{children}</p>
}

/** Prefix/suffix glyph inside a field (¥ / 分) — decoration, never a target. */
function Affix({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span
      className={`pointer-events-none absolute inset-y-0 flex items-center text-[12px] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  )
}

function Money({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <Affix className="left-2.5">¥</Affix>
      <Input
        value={value}
        inputMode="numeric"
        onChange={(e) => onChange(e.target.value)}
        className="pl-6"
      />
    </div>
  )
}

function Field({
  label,
  required,
  className,
  children,
}: {
  label: string
  required?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className ?? ''}`}>
      <span className="mb-1 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="ml-0.5 text-destructive">*</span>}
      </span>
      {children}
    </label>
  )
}
