'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@synqed-kk/ui'
import {
  STAFF_DISCARD_CATEGORIES,
  type StaffDiscardCategory,
} from '@/lib/recording/discard-reasons'

// The discard reason dialog (recording-integrity spec §3.2 / §3.5, PR A2:
// the UI only — A3 wires it to proceedDiscard and the discard route).
//
// A discarded take is the one recording event that leaves no trace anywhere
// else, so the receipt IS the deliverable — and a receipt with no stated
// reason is not a receipt. This sheet is where the reason comes from.
//
// Three things here are contract, not styling choices:
//   1. Five categories, this order, these codes (§3.2). The vocabulary is
//      closed and versioned — it is the axis every discard statistic is cut
//      by. `abandoned` is system-only and NEVER rendered; 6/7 are Phase B.
//   2. There is NO free-text field. Free text has nowhere to live in Phase A
//      (audit `detail` is ids/flags only), and collecting it to drop it would
//      be worse than not offering it.
//   3. The disclosure line is always visible, never behind a tap. In Phase A
//      it is the ONLY disclosure — the staff "discarded" card does not exist
//      yet — and it states exactly what Phase A delivers: a receipt. The
//      Phase-B sentence about content being kept ships in B1, WITH the
//      behaviour it describes; shipping it here would be the dishonesty this
//      lane exists to kill (§3.2 fix B7). A test pins its absence.
//
// Hand-rolled overlay rather than the shared ui/dialog, matching its record-
// screen siblings (RecordingConsentDialog, PostSessionResolutionDialog, and
// RecordPageView's discard-photos confirm).

interface RecordingDiscardReasonDialogProps {
  open: boolean
  /** Sub-floor take (§3.5, under 10 s of captured audio): opens with `mistap`
   *  pre-selected so an accidental tap costs ONE tap to clear. The receipt is
   *  still written and the reason is still stated — nothing is hidden. */
  belowFloor: boolean
  /** In-flight guard (mirrors RecordingConsentDialog's shape): A3 wires this
   *  dialog to the async discard route, and a double tap on confirm before
   *  that await settles would write two discard receipts (BA-1 residual).
   *  Disables confirm and cancel while a submit is in flight. Optional and
   *  defaults to false so today's (still-synchronous) A2 caller is unaffected. */
  submitting?: boolean
  onConfirm: (category: StaffDiscardCategory) => void
  onCancel: () => void
}

export function RecordingDiscardReasonDialog({
  open,
  ...props
}: RecordingDiscardReasonDialogProps) {
  if (!open) return null
  // Remounting on each open is the reset: selection state can never survive a
  // close, so a category picked for one take cannot be confirmed on the next.
  return <DiscardReasonPanel {...props} />
}

function DiscardReasonPanel({
  belowFloor,
  submitting = false,
  onConfirm,
  onCancel,
}: Omit<RecordingDiscardReasonDialogProps, 'open'>) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  // Read once at mount by design — one open cycle = one take. A3 must
  // remount per take (a new open cycle), never mutate `belowFloor` on an
  // already-mounted instance.
  const [selected, setSelected] = useState<StaffDiscardCategory | null>(
    belowFloor ? 'mistap' : null,
  )
  // Move focus INTO the panel on mount — the just-clicked 破棄 button otherwise
  // KEEPS keyboard focus, so a stray Enter would re-fire it behind the
  // backdrop (the sibling consent dialog's precedent, same vector).
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

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
      >
        <h3 className="text-base font-semibold text-foreground">
          {t('discardReason.title')}
        </h3>
        <div
          role="radiogroup"
          aria-label={t('discardReason.title')}
          className="space-y-2"
        >
          {STAFF_DISCARD_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              role="radio"
              aria-checked={selected === category}
              onClick={() => setSelected(category)}
              className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                selected === category
                  ? 'border-primary bg-primary/8 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {t(`discardReason.category.${category}`)}
            </button>
          ))}
        </div>
        <p className="rounded-lg bg-blue-50 px-3 py-2.5 text-[11px] leading-relaxed text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          {t('discardReason.disclosure')}
        </p>
        {/* Phase A's honest answer to "the customer asked me to stop": today's
            behaviour, stated rather than hidden (§14.1 fix L2). */}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {t('discardReason.help')}
        </p>
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
            disabled={submitting || selected === null}
            onClick={() => selected && onConfirm(selected)}
          >
            {t('discardReason.confirm')}
          </Button>
        </div>
      </div>
    </>
  )
}
