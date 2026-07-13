'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@synqed-kk/ui'

// The recording-consent capture dialog — the staff reads the script to the
// customer and confirms the verbal grant. ONE component for both places a
// consent can be captured: the record page (before starting a booked-customer
// take) and the review screen (a walk-in take being attached to a customer at
// save — the gate the record-page flow never saw).
export function RecordingConsentDialog({
  customerName,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  customerName: string
  submitting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  // Move focus INTO the dialog on mount: the opener (a just-clicked save
  // button) otherwise KEEPS keyboard focus, so a stray Enter would activate
  // it again behind the backdrop — the double-save vector the adversarial
  // review caught. Container focus (tabIndex -1) is the standard move.
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
        aria-label={t('consentDialogTitle')}
        className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl bg-card p-6 shadow-xl ring-1 ring-border outline-none">
        <h3 className="text-base font-semibold text-foreground">{t('consentDialogTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('consentDialogInstructions')}</p>
        <div className="rounded-md bg-muted p-4 text-sm leading-relaxed text-foreground">
          {t('consentScript', { customerName })}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
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
          <Button
            variant="default"
            size="md"
            className="flex-1"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? tc('saving') : t('consentConfirmButton')}
          </Button>
        </div>
      </div>
    </>
  )
}
