'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { setRecordingShared } from '@/actions/recording-share'

interface RecordingShareToggleProps {
  karuteId: string
  shared: boolean
}

/** How long an optimistic display is trusted before it self-corrects even
 *  without a confirming prop change (see the FIX ROUND 1 note below) —
 *  generous next to a normal round-trip, short next to "never". */
const OPTIMISTIC_SETTLE_MS = 5000

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
 *
 * FIX ROUND 1 (Fable line-audit, 2026-09-14): `setBusy(false)` used to run
 * BEFORE `router.refresh()`'s server round-trip resolved, so a SUCCESSFUL
 * share rendered 管理者に共有 → 共有中… → 管理者に共有 (the stale prop, for the
 * length of the round-trip) → 共有中 — that middle frame read as a failed
 * tap. `optimistic` displays the NEW state immediately on success and holds
 * it until the refreshed `shared` prop actually arrives (the effect below),
 * so the chip never flashes back to stale.
 *
 * DISCLOSED GAP found while testing the packet's own claim ("if the server
 * disagrees, the display reverts honestly"): for a BOOLEAN prop, the only
 * value a disagreement can arrive as is the value `shared` already held
 * BEFORE this toggle — which means `useEffect(…, [shared])` can never see a
 * dependency change to react to (the value never differs across renders),
 * so the packet's literal `[shared]`-only effect cannot detect that case at
 * all. A settle TIMEOUT closes the gap: it clears the optimistic override
 * unconditionally after `OPTIMISTIC_SETTLE_MS`, so a disagreement still
 * self-corrects — not the instant the fresh (identical-looking) data lands,
 * but within a bounded, generous window, rather than staying wrong forever.
 * The ordinary confirm path (the value genuinely changes) still corrects
 * instantly via the prop-diff effect below, unaffected.
 */
export function RecordingShareToggle({ karuteId, shared }: RecordingShareToggleProps) {
  const t = useTranslations('karuteDetail.transcript')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shown = optimistic ?? shared

  const clearSettleTimer = () => {
    if (settleTimer.current !== null) {
      clearTimeout(settleTimer.current)
      settleTimer.current = null
    }
  }

  // The prop changing means the server actually answered — real state wins,
  // whatever it says (a share the server refused reverts here, honestly).
  useEffect(() => {
    setOptimistic(null)
    clearSettleTimer()
  }, [shared])

  // Unmount safety: never let a pending timer fire setState on a gone card.
  useEffect(() => clearSettleTimer, [])

  const toggle = async () => {
    setBusy(true)
    setFailed(false)
    const next = !shown
    const result = await setRecordingShared(karuteId, next)
    setBusy(false)
    if (!result.ok) {
      setOptimistic(null)
      clearSettleTimer()
      setFailed(true)
      return
    }
    setOptimistic(next)
    clearSettleTimer()
    settleTimer.current = setTimeout(() => setOptimistic(null), OPTIMISTIC_SETTLE_MS)
    router.refresh()
  }

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      {failed && <span className="text-[11px] text-red-500">{t('shareFailed')}</span>}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={shown}
        className={cn(
          'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70',
          shown
            ? 'border border-sky-500/30 bg-sky-500/10 text-sky-600'
            : 'border border-border text-muted-foreground hover:border-sky-500/30 hover:text-sky-600',
        )}
      >
        {busy ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            {t('sharing')}
          </>
        ) : shown ? (
          t('shared')
        ) : (
          t('share')
        )}
      </button>
    </span>
  )
}
