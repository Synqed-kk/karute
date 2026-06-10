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
import type {
  CustomerLifecycle,
  LifecycleStatus,
  PackKind,
  PackWithUsage,
} from '@/lib/packs/types'

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

const SIZE_PRESETS = [3, 6, 10, 20, 50]
const PRICE_PRESETS = [8800, 9350, 9900, 10450]

interface TicketPackCardProps {
  customerId: string
  packs: PackWithUsage[]
  lifecycle: CustomerLifecycle | null
}

export function TicketPackCard({ customerId, packs, lifecycle }: TicketPackCardProps) {
  const t = useTranslations('customers.profile.packs')
  const active = packs.filter((p) => p.status === 'active')
  const inactive = packs.filter((p) => p.status !== 'active')
  // 追加数: the next pack's round = how many counted packs exist already.
  const nextRound = packs.filter((p) => p.kind === 'pack').length

  return (
    <section className="rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6">
      <header className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center text-emerald-600 dark:text-emerald-400">
            <Ticket size={15} />
          </span>
          <span className="text-sm font-semibold text-foreground">{t('title')}</span>
          {active.length > 0 && (
            <span className="text-[12px] tabular-nums text-muted-foreground">
              {active.length}
            </span>
          )}
        </div>
        <AddPackDialog customerId={customerId} nextRound={nextRound} />
      </header>

      {active.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          {t('empty')}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {active.map((p) => (
            <PackRow key={p.id} pack={p} customerId={customerId} />
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
  return round === 0 ? t('roundFirst') : t('roundN', { n: round })
}

function PackRow({ pack, customerId }: { pack: PackWithUsage; customerId: string }) {
  const t = useTranslations('customers.profile.packs')
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  // Low-remaining nudge — the "talk about the next pack" moment.
  const low = pack.kind === 'pack' && pack.remaining <= 1

  const redeem = async () => {
    setBusy(true)
    const res = await redeemSessionAction({ packId: pack.id, customerId })
    setBusy(false)
    setConfirming(false)
    if (res.ok) {
      toast.success(t('redeemDone'))
      router.refresh()
    } else {
      toast.error(t('redeemFailed'))
    }
  }

  return (
    <li className="rounded-xl border border-border/70 p-3.5">
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
            low ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
          }`}
        >
          {t('remaining', { n: pack.remaining })}
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

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3 text-[11px] text-muted-foreground">
          {pack.unit_price > 0 && (
            <span className="tabular-nums">
              {t('unconsumed')} <span className="text-foreground">{yen(pack.unconsumedValue)}</span>
            </span>
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
    </li>
  )
}

function LifecycleRow({
  customerId,
  lifecycle,
}: {
  customerId: string
  lifecycle: CustomerLifecycle | null
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
        ? 'border-foreground/20 bg-foreground/10 text-foreground'
        : 'border-border text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3.5">
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

function AddPackDialog({
  customerId,
  nextRound,
}: {
  customerId: string
  nextRound: number
}) {
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
      purchaseRound: kind === 'pack' ? nextRound : 0,
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
