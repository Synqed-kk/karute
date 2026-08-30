'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@synqed-kk/ui'

// The discard reason dialog (recording-integrity spec §3.2, ⚖ 8/17 ruling —
// PR P5-A). Ported off the parked A2 shell (dd5814a6) and rewritten to the
// APPROVED written-reason mock: the category list is gone.
//
// Three things here are contract, not styling choices:
//   1. A REQUIRED WRITTEN reason, no menu (⚖ 8/17). Discarding a recording is
//      abnormal by definition — there is no one-tap out, and `belowFloor`
//      pre-selection died with the vocabulary (below_floor survives only as a
//      server-derived data flag on the receipt).
//   2. The disclosure line is always visible, never behind a tap, and states
//      exactly what P5-A delivers: a receipt plus the written reason. The
//      Phase-B sentence about CONTENT being kept ships in B1, WITH the
//      behaviour it describes. A test pins its absence.
//   3. Confirm is the final commitment gate for the whole discard, so a failed
//      write must leave the staff member where they were: the error renders
//      inline, the typed reason survives, retry and cancel both still work.
//      Nothing is discarded until the trace has landed.
//
// Hand-rolled overlay rather than the shared ui/dialog, matching its record-
// screen siblings (RecordingConsentDialog, PostSessionResolutionDialog, and
// RecordPageView's discard-photos confirm). The keyboard containment, Escape
// close, backdrop/submitting guards and max-h below all carry over from the
// parked shell — they were hardened through review, only the body changed.

/** Same F8 hygiene as the server schema it feeds (lib/recording/discard.ts):
 *  the field is capped where it is typed, not only where it is parsed. */
const MAX_REASON_CHARS = 2_000

interface RecordingDiscardReasonDialogProps {
  open: boolean
  /** In-flight guard (mirrors RecordingConsentDialog's shape): the confirm
   *  handler awaits the session-id mint, the reason row and the receipt, and a
   *  double tap before that settles would file the discard twice. Disables
   *  confirm, cancel, Escape and the backdrop while a submit is in flight. */
  submitting?: boolean
  /** Inline failure copy. Non-null means the last confirm did NOT discard
   *  anything — the take is still there and the reason text is still in the
   *  field. */
  error?: string | null
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export function RecordingDiscardReasonDialog({
  open,
  ...props
}: RecordingDiscardReasonDialogProps) {
  if (!open) return null
  // Remounting on each open is the reset: a reason typed for one take can
  // never survive a close and be confirmed on the next.
  return <DiscardReasonPanel {...props} />
}

function DiscardReasonPanel({
  submitting = false,
  error = null,
  onConfirm,
  onCancel,
}: Omit<RecordingDiscardReasonDialogProps, 'open'>) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  const [reason, setReason] = useState('')

  // Move focus into the TEXTAREA on mount — not the panel div the parked
  // shell focused (the old category UI had no input). Two jobs at once: the
  // just-clicked 破棄 button loses keyboard focus, so a stray Enter cannot
  // re-fire it behind the backdrop, and the staff member can start typing.
  const panelRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  // Submitting disables every control, which used to drop keyboard containment
  // entirely: the focused textarea was disabled out from under the caret, focus
  // fell to <body>, and the panel's onKeyDown then stopped firing — so Escape
  // and the Tab wrap were both dead for the whole round-trip. Pull focus back to
  // the panel (tabIndex -1) so the handler keeps receiving keys; Escape is still
  // a deliberate no-op while submitting, but it is a no-op we CHOOSE rather than
  // one the DOM imposes.
  useEffect(() => {
    if (submitting) panelRef.current?.focus()
  }, [submitting])

  // Keyboard containment (Greptile r1, carried): Escape cancels, guarded by
  // `submitting` same as the other three exits (backdrop/Cancel/Confirm).
  // Tab/Shift+Tab wrap within the panel — the DOM already puts every focusable
  // control in tab order inside it, so the only work is catching the two wrap
  // edges (last→first, first→last) rather than letting focus escape to the
  // page. The textarea joins that set now. No focus-trap library.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (!submitting) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), textarea:not(:disabled)',
      ) ?? [],
    )
    // If a future state ever disables every control, keep focus on the panel
    // rather than letting it fall out to the page.
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const canConfirm = reason.trim().length > 0 && !submitting

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={() => !submitting && onCancel()}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('discardReason.title')}
        className="fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl outline-none"
        onKeyDown={handleKeyDown}
      >
        <h3 className="text-base font-semibold text-foreground">
          {t('discardReason.title')}
        </h3>
        <textarea
          ref={textareaRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={submitting}
          rows={4}
          maxLength={MAX_REASON_CHARS}
          // Its OWN name, not the dialog's — the two carried the same string, so
          // a screen reader announced the identical phrase twice and the field
          // itself had no distinct label.
          aria-label={t('discardReason.fieldLabel')}
          placeholder={t('discardReason.placeholder')}
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <p className="rounded-lg bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          {t('discardReason.disclosure')}
        </p>
        {error && (
          <p role="alert" className="text-[11px] leading-relaxed text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <Button
            variant="outline"
            size="md"
            className="flex-1"
            onClick={onCancel}
            disabled={submitting}
          >
            {tc('cancel')}
          </Button>
          {/* Irreversible, so it stays solid red — never the accent fill.
              Explicit red-600/white rather than the package's `destructive`
              variant, whose --color-destructive-text token this theme never
              defines (CancelConfirmDialog's precedent). */}
          <Button
            size="md"
            className="flex-1 bg-red-600 text-white hover:bg-red-700"
            disabled={!canConfirm}
            onClick={() => canConfirm && onConfirm(reason.trim())}
          >
            {submitting ? t('discardReason.submitting') : t('discardReason.confirm')}
          </Button>
        </div>
      </div>
    </>
  )
}
