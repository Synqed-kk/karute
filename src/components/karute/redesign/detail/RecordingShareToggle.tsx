'use client'

import { useEffect, useState } from 'react'
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
 *
 * FIX ROUND 1 (Fable line-audit, 2026-09-14): `setBusy(false)` used to run
 * BEFORE `router.refresh()`'s server round-trip resolved, so a SUCCESSFUL
 * share rendered 管理者に共有 → 共有中… → 管理者に共有 (the stale prop, for the
 * length of the round-trip) → 共有中 — that middle frame read as a failed
 * tap. `optimistic` displays the NEW state immediately on success and holds
 * it until the refreshed `shared` prop actually arrives (the effect below),
 * so the chip never flashes back to stale.
 *
 * FIX ROUND 2 (ruling on round 1's disclosed gap): `setRecordingSharedWithClient`
 * returns `shared: input.shared` on EVERY `ok` result — both the written and
 * the idempotent-no-op branch (share.ts) — so once `result.ok` is true, the
 * server state IS the requested state by contract; "the server disagreed"
 * cannot happen on a successful result. `optimistic` is therefore seeded
 * from `result.shared` (the server's own confirmed answer), never from a
 * locally-guessed `!shown` — and the `[shared]` prop-change effect is the
 * WHOLE mechanism: the refreshed prop arriving means the override is no
 * longer needed, and a prop that never arrives just keeps showing the
 * server-confirmed truth, which is honest either way. No timer.
 */
export function RecordingShareToggle({ karuteId, shared }: RecordingShareToggleProps) {
  const t = useTranslations('karuteDetail.transcript')
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const shown = optimistic ?? shared

  // The prop changing means the server actually answered — real state wins,
  // whatever it says (a share the server refused reverts here, honestly).
  useEffect(() => {
    setOptimistic(null)
  }, [shared])

  const toggle = async () => {
    setBusy(true)
    setFailed(false)
    const result = await setRecordingShared(karuteId, !shown)
    setBusy(false)
    if (!result.ok) {
      setOptimistic(null)
      setFailed(true)
      return
    }
    setOptimistic(result.shared)
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
          // CLAUDE.md R13's selected/pressed recipe (chips/options): bg-primary/8
          // text-primary + border-primary — never a literal sky color.
          shown
            ? 'border border-primary bg-primary/8 text-primary'
            : 'border border-border text-muted-foreground hover:border-primary hover:text-primary',
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
