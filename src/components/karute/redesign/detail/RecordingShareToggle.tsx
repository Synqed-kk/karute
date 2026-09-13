'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setRecordingShared } from '@/actions/recording-share'

interface RecordingShareToggleProps {
  karuteId: string
  shared: boolean
}

/**
 * The recorder's own 共有 toggle (⚖ Liam 2026-09-13 sharing law; 2026-09-14
 * design D11 FINAL): a one-tap REVERSIBLE toggle — no confirmation of any
 * kind, no sheet, no dialog. The control's own state IS the feedback.
 * Rendered only when `share?.canShare` is true (RecordingTranscriptCard) —
 * the record's OWN staffer, on a live record with a recording row (D2).
 *
 * ONE control, every state (D11): idle (bordered, muted — the
 * RegenerateEntriesButton idiom) → busy (spinner) → the washed sky chip
 * 「共有中」. Tapping the chip flips back — narrowing needs no confirm either.
 * A refused write never replaces the control: the native failure line
 * renders BESIDE it (same idiom as RegenerateEntriesButton's error span) and
 * the control returns to its pre-tap state.
 */
export function RecordingShareToggle({ karuteId, shared }: RecordingShareToggleProps) {
  const t = useTranslations('karuteDetail.transcript')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const toggle = async () => {
    setBusy(true)
    setFailed(false)
    const result = await setRecordingShared(karuteId, !shared)
    setBusy(false)
    if (!result.ok) {
      setFailed(true)
      return
    }
    router.refresh()
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {failed && <span className="text-[11px] text-red-500">{t('shareFailed')}</span>}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={shared}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
          shared
            ? 'border border-sky-500/30 bg-sky-500/10 text-sky-600'
            : 'border border-border text-muted-foreground hover:border-sky-500/30 hover:text-sky-600',
        )}
      >
        {busy ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {t('sharing')}
          </>
        ) : shared ? (
          t('shared')
        ) : (
          t('share')
        )}
      </button>
    </span>
  )
}
