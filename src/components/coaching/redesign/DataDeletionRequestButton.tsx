'use client'

// ─────────────────────────────────────────────────────────────
// DataDeletionRequestButton — staff data deletion flow
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/DataDeletionRequestButton.tsx
// (~72 lines).
//
// PRIVACY: Layer 1 mutation.
//   The button lets a staff member request deletion of their
//   own coaching data (recordings, transcripts, personal AI
//   suggestions, analysis output). Performance metrics +
//   business records stay — those are owner-side data, not
//   staff-private.
//
// ANTHONY: the submit handler here is a UX demo with a 1.8s
// fake delay. Real wiring:
//
//   1. INSERT a row into coaching_deletion_requests (staff_id,
//      requested_at, status='pending') — staff can write only
//      their own row via RLS.
//   2. Send a Supabase realtime notification to the owner of
//      that staff's business.
//   3. Background job (Anthony / Pingr) performs the actual
//      deletion within the SLA window (≤30 days per the
//      copy below).
//   4. UPDATE the row to status='completed' when done.
//
// The owner sees that a deletion was REQUESTED but never the
// withdrawal reason (no reason field exposed — staff don't
// have to justify).

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function DataDeletionRequestButton() {
  const t = useTranslations('coaching.data.deletion')
  const [open, setOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = () => {
    setSubmitted(true)
    // Demo: auto-dismiss the confirmation after 1.8s. Anthony
    // replaces this with the real INSERT + realtime notify.
    setTimeout(() => {
      setOpen(false)
      setSubmitted(false)
    }, 1800)
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/20 dark:text-red-300 dark:hover:bg-red-500/10 dark:hover:text-red-200"
      >
        <Trash2 className="size-3.5" aria-hidden />
        {t('cta')}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          {submitted ? (
            <DialogHeader>
              <DialogTitle>{t('submittedTitle')}</DialogTitle>
              <DialogDescription className="pt-2 leading-relaxed">
                {t('submittedBody')}
              </DialogDescription>
            </DialogHeader>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t('confirmTitle')}</DialogTitle>
                <DialogDescription className="pt-2 leading-relaxed">
                  {t('confirmBody')}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={handleSubmit}
                  className="bg-red-600 hover:bg-red-700"
                >
                  {t('submit')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
