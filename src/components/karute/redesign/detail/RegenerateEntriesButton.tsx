'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { RefreshCw, Loader2 } from 'lucide-react'
import type { Entry } from '@/types/ai'
import {
  regenerateKaruteEntries,
  updateKaruteSummary,
} from '@/actions/regenerate-karute'

interface RegenerateEntriesButtonProps {
  karuteRecordId: string
  /** The record's stored transcript — re-extraction runs on this. */
  transcript: string
}

/**
 * Re-runs the (now business-aware, consolidation-tightened) extraction prompt on
 * a saved karute's transcript and replaces its entries. Two-click confirm — this
 * overwrites the current entries. Entries only (the API can't replace the summary).
 */
export function RegenerateEntriesButton({
  karuteRecordId,
  transcript,
}: RegenerateEntriesButtonProps) {
  const t = useTranslations('karuteDetail.regenerate')
  const locale = useLocale()
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)

  const run = async () => {
    setConfirming(false)
    setRunning(true)
    setError(null)
    setWarning(null)
    try {
      // Re-extract entries AND re-summarize, in parallel, on the stored
      // transcript — both via the same authed routes the recording flow uses
      // (server-side they apply the business persona + the tightened prompts).
      // This is the backfill: refresh 本日のセッション (entries) + AI要約 (summary)
      // together, so improving the prompts upgrades past sessions' data.
      const [extractRes, summaryRes] = await Promise.all([
        fetch('/api/ai/extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, locale }),
        }),
        fetch('/api/ai/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript, locale }),
        }),
      ])

      if (!extractRes.ok) throw new Error(`extract failed (${extractRes.status})`)
      const entries =
        ((await extractRes.json()) as { entries?: Entry[] }).entries ?? []
      if (entries.length === 0) throw new Error('no entries extracted')

      // Summary is best-effort — never fail the whole regenerate on it.
      const newSummary = summaryRes.ok
        ? ((await summaryRes.json()) as { summary?: string }).summary
        : undefined

      const result = await regenerateKaruteEntries(karuteRecordId, entries)
      if (result.error) throw new Error(result.error)

      // Soft caveat — the entries WERE replaced, but some old rows lingered.
      // Surface it (non-blocking) so staff know a re-run finishes cleanup.
      if (result.warning) setWarning(result.warning)

      // Refresh the summary too (best-effort — entries already applied).
      if (newSummary?.trim()) {
        await updateKaruteSummary(karuteRecordId, newSummary)
      }

      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'error')
    } finally {
      setRunning(false)
    }
  }

  if (running) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 size={12} className="animate-spin" />
        {t('running')}
      </span>
    )
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          type="button"
          onClick={run}
          className="rounded-md bg-sky-500 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-sky-600"
        >
          {t('confirm')}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('cancel')}
        </button>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[11px] text-red-500">{t('error')}</span>}
      {!error && warning && (
        <span className="text-[11px] text-amber-600">{t('warning')}</span>
      )}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-sky-500/30 hover:text-sky-600"
      >
        <RefreshCw size={12} />
        {t('label')}
      </button>
    </span>
  )
}
