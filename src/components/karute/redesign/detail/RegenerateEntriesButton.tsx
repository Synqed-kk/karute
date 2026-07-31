'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { RefreshCw, Loader2 } from 'lucide-react'
import { regenerateKarute } from '@/actions/regenerate-karute'

interface RegenerateEntriesButtonProps {
  karuteRecordId: string
}

/**
 * Re-runs the (business-aware, consolidation-tightened) extraction + summary on a
 * saved karute's stored transcript and replaces its entries. Two-click confirm —
 * regenerates the AI-authored entries only (I1); any staff-edited or hand-added
 * entry is kept, never deleted. The confirm-step copy says so.
 *
 * The whole extract → summarize → apply flow now runs SERVER-side in a single
 * action (packet 07 Decision 2): the client sends only the id, the server reads
 * the authoritative transcript, enforces the recording-privacy ACL, and applies
 * via the integrity cores. No transcript / prompt anchors round-trip through the
 * client, and the same action serves the mobile facade.
 */
export function RegenerateEntriesButton({
  karuteRecordId,
}: RegenerateEntriesButtonProps) {
  const t = useTranslations('karuteDetail.regenerate')
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
      const result = await regenerateKarute(karuteRecordId)
      if (result.error) throw new Error(result.error)
      // Soft caveat — the entries WERE replaced, but some old rows lingered, OR
      // the summary refresh failed. Non-blocking so staff know a re-run finishes.
      if (result.warning) setWarning(t('warning'))
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
        <span className="text-[11px] text-amber-600">{warning}</span>
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
