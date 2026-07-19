'use client'

import { getDataPort } from '@/lib/ports/data-port'
import { getRecordingPipelinePort } from '@/lib/ports/recording-port'

// ⚠️ TEMPORARY BUILD TOOL — remove once historical karute are backfilled with the
// latest prompts. Re-runs extraction + summary across ALL of a customer's karute
// in one pass (reusing the per-karute regenerate flow), so improving a prompt can
// be applied to the whole history without opening each karute. Sequential — one
// karute at a time — to stay gentle on the AI rate limit.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { RefreshCw, Loader2, Check } from 'lucide-react'
import type { Entry } from '@/types/ai'
import { canUseDevRegen } from '@/actions/dev-tools'
import {
  listCustomerKaruteForRegen,
  regenerateKaruteEntries,
  updateKaruteSummary,
} from '@/actions/regenerate-karute'

export function RegenerateAllForCustomerButton({
  customerId,
}: {
  customerId: string
}) {
  const t = useTranslations('karuteDetail.regenerate')
  const locale = useLocale()
  const router = useRouter()
  const [phase, setPhase] = useState<'idle' | 'confirming' | 'running' | 'done'>(
    'idle',
  )
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 })
  // Owner-only (dev tool): the backing list action ships every raw transcript,
  // and recordings are recorder-private. Default false = staff never see the
  // button; the server action refuses on its own regardless. Same gate + shape
  // as the 再学習 chip in CustomerMemoryCard.
  const [canRegen, setCanRegen] = useState(false)
  useEffect(() => {
    let alive = true
    canUseDevRegen()
      .then((ok) => {
        if (alive) setCanRegen(ok)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const run = async () => {
    setPhase('running')
    const list = await listCustomerKaruteForRegen(customerId)
    setProgress({ done: 0, total: list.length, failed: 0 })
    let done = 0
    let failed = 0
    for (const k of list) {
      try {
        // aiBase seam (F-9d): the facade twins exist — route through them in the shell.
        const [ex, su] = await Promise.all([
          getDataPort().apiFetch(`${getRecordingPipelinePort().aiBase}/extract`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: k.transcript, locale }),
          }),
          getDataPort().apiFetch(`${getRecordingPipelinePort().aiBase}/summarize`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: k.transcript, locale }),
          }),
        ])
        const entries = ex.ok
          ? (((await ex.json()) as { entries?: Entry[] }).entries ?? [])
          : []
        const summary = su.ok
          ? ((await su.json()) as { summary?: string }).summary
          : undefined
        if (entries.length > 0) await regenerateKaruteEntries(k.id, entries)
        if (summary?.trim()) await updateKaruteSummary(k.id, summary)
        done += 1
      } catch {
        failed += 1
      }
      setProgress({ done, total: list.length, failed })
    }
    setPhase('done')
    router.refresh()
  }

  if (!canRegen) return null
  if (phase === 'running') {
    return (
      <div className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 size={13} className="animate-spin" />
        {t('allRunning', { done: progress.done, total: progress.total })}
      </div>
    )
  }
  if (phase === 'done') {
    return (
      <div className="inline-flex items-center gap-2 text-[12px] text-emerald-600">
        <Check size={13} />
        {t('allDone', { done: progress.done, failed: progress.failed })}
      </div>
    )
  }
  if (phase === 'confirming') {
    return (
      <span className="inline-flex items-center gap-2">
        <button
          type="button"
          onClick={run}
          className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sky-600"
        >
          {t('confirm')}
        </button>
        <button
          type="button"
          onClick={() => setPhase('idle')}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('cancel')}
        </button>
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => setPhase('confirming')}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-sky-500/30 hover:text-sky-600"
    >
      <RefreshCw size={12} />
      {t('all')}
    </button>
  )
}
