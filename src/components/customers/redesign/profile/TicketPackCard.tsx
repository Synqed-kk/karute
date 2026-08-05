'use client'

// 回数券・サブスク card — the at-a-glance pack status that replaces Kitano's
// manual sheet columns (最新回数券 / 残回数 / 消化残高 / 追加数). Always visible
// under the identity section so staff see "残り1回 → next-pack conversation"
// before a session without digging.
//
// Reads PackWithUsage rows computed server-side (single-source withUsage()).
// Writes only through the pack server actions (tables are RLS-locked).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Check, Loader2, Plus, Ticket } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  createPackAction,
  redeemSessionAction,
  setLifecycleAction,
} from '@/actions/packs'
import {
  type CustomerLifecycle,
  type LifecycleStatus,
  type PackKind,
  type PackWithUsage,
} from '@/lib/packs/types'
import { DEFAULT_CONTACT_THRESHOLD_DAYS } from '@/lib/packs/resolve'
import { jstDaysBetween } from '@/lib/date/jst'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

const SIZE_PRESETS = [3, 6, 10, 20, 50]
const PRICE_PRESETS = [8800, 9350, 9900, 10450]

interface TicketPackCardProps {
  customerId: string
  packs: PackWithUsage[]
  /** Upcoming booking on file — softens the 使い切り hint (they're coming). */
  hasNextBooking?: boolean
  lifecycle: CustomerLifecycle | null
  /** Customer's 目安 visit interval (days) from 来店ペース — lets each pack show
   *  how long it lasts at their cadence ("いまのペースで約N分"). null when no solid
   *  cadence. This is the ONE home for the span (it was duplicated in the pace card). */
  avgIntervalDays?: number | null
  /** Org-level 回数券 master switch. Off → only the lifecycle row renders
   *  (卒業/離客/口コミ is customer state, not a ticket feature). */
  ticketsEnabled?: boolean
}

export function TicketPackCard({
  customerId,
  packs,
  lifecycle,
  hasNextBooking = false,
  avgIntervalDays = null,
  ticketsEnabled = true,
}: TicketPackCardProps) {
  const t = useTranslations('customers.profile.packs')
  const active = packs.filter((p) => p.status === 'active')
  const inactive = packs.filter((p) => p.status !== 'active')

  if (!ticketsEnabled) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
        <LifecycleRow customerId={customerId} lifecycle={lifecycle} bare />
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-sm md:p-5">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Ticket size={15} className="text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          {active.length > 0 && (
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {active.length}
            </span>
          )}
        </div>
        <AddPackDialog customerId={customerId} />
      </header>

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {active.map((p) => (
            <PackRow
              key={p.id}
              pack={p}
              customerId={customerId}
              hasNextBooking={hasNextBooking}
              avgIntervalDays={avgIntervalDays}
              hasNewerActive={packs.some(
                (o) =>
                  o.id !== p.id &&
                  o.kind === 'pack' &&
                  o.status === 'active' &&
                  o.remaining > 0,
              )}
            />
          ))}
        </ul>
      )}

      {inactive.length > 0 && (
        <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 border-t border-border/60 p-0 pt-3">
          {inactive.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between text-[12px] text-muted-foreground"
            >
              <span>
                {packLabel(p, t)}
                {p.purchased_at ? ` · ${p.purchased_at}` : ''}
              </span>
              <span>{p.status === 'exhausted' ? t('exhausted') : t('cancelledPack')}</span>
            </li>
          ))}
        </ul>
      )}

      <LifecycleRow customerId={customerId} lifecycle={lifecycle} />
    </section>
  )
}

function packLabel(p: PackWithUsage, t: ReturnType<typeof useTranslations>): string {
  if (p.kind === 'subscription') return t('kindSubscription')
  if (p.kind === 'single') return t('kindSingle')
  return t('kindPack', { n: p.pack_size })
}

function roundLabel(round: number, t: ReturnType<typeof useTranslations>): string {
  // Rounds are 1-based (sheet + June import convention: 初回 = 1). Legacy
  // app-created packs stored 0 — still read as 初回.
  return round <= 1 ? t('roundFirst') : t('roundN', { n: round })
}

function PackRow({
  pack,
  customerId,
  hasNewerActive = false,
  hasNextBooking = false,
  avgIntervalDays = null,
}: {
  pack: PackWithUsage
  customerId: string
  hasNewerActive?: boolean
  hasNextBooking?: boolean
  avgIntervalDays?: number | null
}) {
  const t = useTranslations('customers.profile.packs')
  const tPace = useTranslations('visits.pace')
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  // The state LADDER (Liam-approved): each state names what's true NOW and
  // what to DO. 残1 = talk on the NEXT visit (they're coming back). 残0
  // unrenewed = the visit already happened and didn't close — reach out, the
  // day counter is running. 残0 with a newer pack = quietly 終了.
  const exhausted = pack.kind === 'pack' && pack.remaining === 0
  const closed = exhausted && hasNewerActive
  const low = pack.kind === 'pack' && pack.remaining === 1
  const daysSinceLast = pack.lastRedeemedOn
    ? jstDaysBetween(pack.lastRedeemedOn)
    : null

  // How long this pack lasts at the customer's 来店ペース — a factual 目安, the
  // ONE home for the span (it used to be duplicated in the pace card). Only
  // counted packs with sessions left + a solid cadence.
  let spanLabel: string | null = null
  if (avgIntervalDays != null && pack.kind === 'pack' && pack.remaining > 0) {
    const days = pack.remaining * avgIntervalDays
    const span =
      days >= 60
        ? tPace('coversMonths', { n: Math.round(days / 30) })
        : tPace('coversWeeks', { n: Math.round(days / 7) })
    spanLabel = tPace('atThisPace', { span })
  }

  const redeem = async () => {
    setBusy(true)
    const res = await redeemSessionAction({ packId: pack.id, customerId })
    setBusy(false)
    setConfirming(false)
    if (res.ok) {
      toast.success(t('redeemDone'))
      router.refresh()
    } else {
      toast.error(t(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'))
    }
  }

  return (
    <li
      className={`rounded-xl border border-border/70 p-3.5 ${closed ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            {packLabel(pack, t)}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {roundLabel(pack.purchase_round, t)}
          </span>
          {pack.unit_price > 0 && (
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {t('unitPerSession', { price: pack.unit_price.toLocaleString('ja-JP') })}
            </span>
          )}
        </div>
        <span
          className={`text-[15px] font-semibold tabular-nums ${
            closed
              ? 'text-muted-foreground'
              : low || exhausted
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-foreground'
          }`}
        >
          {closed
            ? t('closedLabel')
            : exhausted
              ? t('exhaustedLabel')
              : t('remaining', { n: pack.remaining })}
        </span>
      </div>

      {/* Consumption — dots up to 12 sessions, slim bar beyond. */}
      {pack.kind === 'pack' && (
        <div className="mt-2.5">
          {pack.pack_size <= 12 ? (
            <div className="flex flex-wrap items-center gap-1">
              {Array.from({ length: pack.pack_size }, (_, i) => (
                <span
                  key={i}
                  className={`size-2 rounded-full ${
                    i < pack.redeemedCount
                      ? 'bg-muted-foreground/30'
                      : 'bg-emerald-500'
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${(pack.remaining / pack.pack_size) * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {spanLabel && (
        <div className="mt-2 text-[11px] text-muted-foreground">
          <span className="text-foreground">{spanLabel}</span>
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3 text-[11px] text-muted-foreground">
          {exhausted ? (
            <span className="tabular-nums">
              {t('consumedAll', { n: pack.pack_size })}
            </span>
          ) : (
            pack.unit_price > 0 && (
              <span className="tabular-nums">
                {t('unconsumed')}{' '}
                <span className="text-foreground">{yen(pack.unconsumedValue)}</span>
              </span>
            )
          )}
          {pack.purchased_at && (
            <span className="tabular-nums">{t('purchased', { date: pack.purchased_at })}</span>
          )}
        </div>
        {pack.kind === 'pack' &&
          pack.remaining > 0 &&
          (confirming ? (
            <span className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={redeem}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                {t('redeemConfirm')}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('cancel')}
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-600"
            >
              {t('redeem')}
            </button>
          ))}
      </div>

      {low && (
        <p className="mt-2 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          {t('lowRemaining')}
        </p>
      )}
      {exhausted && !closed && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <span className="font-semibold">
            {daysSinceLast != null
              ? t('exhaustedHint', { n: daysSinceLast })
              : t('exhaustedHintUnknown')}
          </span>
          {!hasNextBooking && (
            <> {t('exhaustedHintNoBooking', { d: DEFAULT_CONTACT_THRESHOLD_DAYS })}</>
          )}
        </p>
      )}
    </li>
  )
}

function LifecycleRow({
  customerId,
  lifecycle,
  bare = false,
}: {
  customerId: string
  lifecycle: CustomerLifecycle | null
  /** Rendered as the card's only content (tickets off) — no divider above. */
  bare?: boolean
}) {
  const t = useTranslations('customers.profile.packs')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const status: LifecycleStatus = lifecycle?.status ?? 'active'
  const referral = lifecycle?.referral ?? false

  const set = async (next: LifecycleStatus, nextReferral: boolean) => {
    setBusy(true)
    const res = await setLifecycleAction({
      customerId,
      status: next,
      referral: nextReferral,
    })
    setBusy(false)
    if (res.ok) router.refresh()
    else toast.error(t('lifecycleFailed'))
  }

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-60 ${
      active
        ? 'border-primary bg-primary/10 text-primary'
        : 'border-border text-muted-foreground hover:text-foreground'
    }`

  return (
    <div
      className={
        bare
          ? 'flex flex-wrap items-center gap-1.5'
          : 'mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3.5'
      }
    >
      <span className="mr-1 text-[11px] text-muted-foreground">{t('lifecycleLabel')}</span>
      {(['active', 'graduated', 'lost'] as const).map((s) => (
        <button
          key={s}
          type="button"
          disabled={busy}
          onClick={() => status !== s && set(s, referral)}
          className={chip(status === s)}
        >
          {t(`lifecycle_${s}`)}
        </button>
      ))}
      <button
        type="button"
        disabled={busy}
        onClick={() => set(status, !referral)}
        className={`${chip(referral)} ml-1`}
      >
        {t('referral')}
      </button>
    </div>
  )
}

function AddPackDialog({ customerId }: { customerId: string }) {
  const t = useTranslations('customers.profile.packs')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<PackKind>('pack')
  const [size, setSize] = useState<number>(10)
  const [price, setPrice] = useState<number>(9900)
  const [date, setDate] = useState<string>(() =>
    new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    const res = await createPackAction({
      customerId,
      kind,
      packSize: kind === 'single' ? 1 : size,
      unitPrice: price,
      // 購入回数 is server-derived in createPackActionWithClient — never sent.
      purchasedAt: date || null,
      notes: notes.trim() || null,
    })
    setSaving(false)
    if (res.ok) {
      toast.success(t('saved'))
      setOpen(false)
      setNotes('')
      router.refresh()
    } else {
      toast.error(t('saveFailed'))
    }
  }

  const presetChip = (active: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-[12px] font-medium tabular-nums transition-colors ${
      active
        ? 'border-emerald-500/50 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
        : 'border-border text-muted-foreground hover:text-foreground'
    }`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-600">
        <Plus size={13} />
        {t('add')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[15px]">{t('dialogTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
              {t('kindLabel')}
            </div>
            <div className="flex gap-1.5">
              {(['pack', 'subscription', 'single'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={presetChip(kind === k)}
                >
                  {k === 'pack'
                    ? t('kindPackPlain')
                    : k === 'subscription'
                      ? t('kindSubscription')
                      : t('kindSingle')}
                </button>
              ))}
            </div>
          </div>

          {kind !== 'single' && (
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
                {t('sizeLabel')}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {SIZE_PRESETS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSize(s)}
                    className={presetChip(size === s)}
                  >
                    {s}回
                  </button>
                ))}
                <input
                  type="number"
                  min={1}
                  value={size}
                  onChange={(e) => setSize(Math.max(1, Number(e.target.value) || 1))}
                  className="w-20 rounded-md border border-border bg-transparent px-2 py-1.5 text-[12px] tabular-nums text-foreground"
                  aria-label={t('sizeLabel')}
                />
              </div>
            </div>
          )}

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
              {t('priceLabel')}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRICE_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPrice(p)}
                  className={presetChip(price === p)}
                >
                  {yen(p)}
                </button>
              ))}
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                className="w-24 rounded-md border border-border bg-transparent px-2 py-1.5 text-[12px] tabular-nums text-foreground"
                aria-label={t('priceLabel')}
              />
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
              {t('dateLabel')}
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-border bg-transparent px-2 py-1.5 text-[12px] text-foreground"
            />
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted-foreground">
              {t('notesLabel')}
            </div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/60"
            />
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-60"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {t('save')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
