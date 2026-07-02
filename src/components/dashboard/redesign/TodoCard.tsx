'use client'

// やること（本日） — my unfinished business from TODAY only, max 3 rows,
// gone when empty. Two miss types, each with its fix inline: a finished
// session with no karute (→ 録音する, deep-links the recording flow to that
// booking) and a pack holder's visit with no ticket burned (→ 消化, same
// backfill action the reconcile strip uses, undo toast included). The
// historical backlog stays off the front page (owner band).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { toast } from 'sonner'
import { redeemSessionAction, undoRedemptionAction } from '@/actions/packs'
import type { ReconcileEntry } from '@/lib/packs/reconcile'

export interface KaruteTodoView {
  appointmentId: string
  customerName: string
  timeHm: string
}

interface TodoCardProps {
  karuteTodos: KaruteTodoView[]
  redeemTodos: ReconcileEntry[]
}

function RedeemRow({ entry }: { entry: ReconcileEntry }) {
  const t = useTranslations('dashboard.flow')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const redeem = async () => {
    if (!entry.packId) return
    setBusy(true)
    const res = await redeemSessionAction({
      packId: entry.packId,
      customerId: entry.customerId,
      redeemedOn: entry.visitDay,
      appointmentId: entry.appointmentId,
      source: 'backfill',
    })
    setBusy(false)
    if (res.ok) {
      const rid = res.redemptionId
      toast.success(t('redeemed', { name: entry.name }), {
        action: rid
          ? {
              label: t('undo'),
              onClick: () => {
                void undoRedemptionAction(rid).then(() => router.refresh())
              },
            }
          : undefined,
      })
      router.refresh()
    } else {
      toast.error(t('redeemFailed'))
    }
  }
  return (
    <li className="flex items-center gap-2 py-1.5 text-[13px]">
      <span className="min-w-0 truncate text-amber-900 dark:text-amber-200">
        {t('redeemMissing', { name: entry.name })}
      </span>
      <button
        type="button"
        onClick={redeem}
        disabled={busy || !entry.packId}
        className="ml-auto shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300"
      >
        {t('redeemCta')}
      </button>
    </li>
  )
}

export function TodoCard({ karuteTodos, redeemTodos }: TodoCardProps) {
  const t = useTranslations('dashboard.flow')
  const total = karuteTodos.length + redeemTodos.length
  if (total === 0) return null
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <h2 className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
        {t('todosTitle', { n: total })}
      </h2>
      <ul className="mt-1">
        {karuteTodos.map((k) => (
          <li key={k.appointmentId} className="flex items-center gap-2 py-1.5 text-[13px]">
            <span className="min-w-0 truncate text-amber-900 dark:text-amber-200">
              {t('karuteMissing', { name: k.customerName, time: k.timeHm })}
            </span>
            <Link
              href={{ pathname: '/sessions', query: { appointmentId: k.appointmentId } }}
              className="ml-auto shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300"
            >
              {t('recordCta')}
            </Link>
          </li>
        ))}
        {redeemTodos.map((e) => (
          <RedeemRow key={`${e.customerId}|${e.visitDay}`} entry={e} />
        ))}
      </ul>
    </section>
  )
}
