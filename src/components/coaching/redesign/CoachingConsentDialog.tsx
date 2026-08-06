'use client'

// ─────────────────────────────────────────────────────────────
// CoachingConsentDialog — Layer 1 staff opt-in
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: components/coaching/CoachingConsentDialog.tsx
// (~226 lines). Visual + flow preserved with one intentional
// difference: spike's mobile branch used a SheetBottom; karute
// uses Dialog only (full-screen friendly via styling). The dual
// Sheet/Dialog branch with useIsMobile() is nice-to-have but
// adds complexity for negligible UX gain.
//
// Three content sections (spike order preserved):
//   1. 記録・分析される内容 — what's recorded/analyzed
//   2. オーナー・マネージャーが閲覧できる情報 — what owner sees
//      (Layer 2: aggregated metrics + growth trends, NEVER raw
//      transcripts)
//   3. オーナー・マネージャーが閲覧できない情報 — what owner can't
//      see (Layer 1: raw transcripts, individual sessions,
//      specific customer exchanges, personalized learning tips)
//
// Plus:
//   - Data retention note (TBD by Anthony)
//   - "Decline won't affect your work" reassurance
//   - Checkbox confirmation required before 同意 button enables
//   - Two actions: 同意しない / 同意する (decline / agree)
//
// CONTRACT (from spike header verbatim)
// -------------------------------------
//   - Consent is append-only (INSERT into consent_log, never
//     UPDATE) — see src/lib/coaching-consent/hooks.ts for the
//     schema sketch + RLS policies
//   - Policy version locked at the time of insert
//   - Owner reads only the rollup view (granted boolean +
//     givenAt + policyVersion) — never the raw log

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, Cloud, Shield } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface CoachingConsentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the user grants OR declines. The parent's
   *  mutations hook handles the actual write. */
  onConsent: (granted: boolean) => void
}

export function CoachingConsentDialog({
  open,
  onOpenChange,
  onConsent,
}: CoachingConsentDialogProps) {
  const t = useTranslations('coaching.consent')
  const [checked, setChecked] = useState(false)

  const handleAgree = () => {
    onConsent(true)
    onOpenChange(false)
  }
  const handleDecline = () => {
    onConsent(false)
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        // Reset checkbox when reopened so a previous click doesn't
        // carry over.
        if (!o) setChecked(false)
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Shield className="size-5 text-indigo-600 dark:text-indigo-300" />
            {t('headerTitle')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-2 text-[15px] leading-relaxed">
          {/* Section 1 — what's recorded */}
          <section>
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('section1Title')}
            </h3>
            <ul className="space-y-1.5 text-foreground">
              <BulletItem text={t('section1Bullet1')} dot="muted" />
              <BulletItem text={t('section1Bullet2')} dot="muted" />
              <BulletItem text={t('section1Bullet3')} dot="muted" />
            </ul>
          </section>

          {/* Section 2 — Layer 2 (owner CAN see) */}
          <section className="rounded-lg bg-muted/40 p-4">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-foreground/80">
              {t('section2Title')}
            </h3>
            <ul className="space-y-1.5 text-foreground/90">
              <BulletItem text={t('section2Bullet1')} dot="muted" />
              <BulletItem text={t('section2Bullet2')} dot="muted" />
              <BulletItem text={t('section2Bullet3')} dot="muted" />
              <BulletItem text={t('section2Bullet4')} dot="muted" />
            </ul>
          </section>

          {/* Section 3 — Layer 1 (owner CANNOT see) */}
          <section className="rounded-lg bg-indigo-50/50 p-4 ring-1 ring-indigo-100 dark:bg-indigo-500/[0.06] dark:ring-indigo-500/15">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-indigo-900 dark:text-indigo-200">
              {t('section3Title')}
            </h3>
            <ul className="space-y-1.5 text-foreground/90">
              <BulletItem text={t('section3Bullet1')} dot="indigo" />
              <BulletItem text={t('section3Bullet2')} dot="indigo" />
              <BulletItem text={t('section3Bullet3')} dot="indigo" />
              <BulletItem text={t('section3Bullet4')} dot="indigo" />
            </ul>
          </section>

          {/* Section 4 — Synqed (service provider) access. Legally
           *  precise disclosure: the SaaS provider is a separate
           *  party from the salon owner with a different data-use
           *  relationship governed by ToS + DPA. Without this
           *  section we'd be relying on implicit consent for
           *  anonymized pattern extraction + AI training. */}
          <section className="rounded-lg bg-violet-50/50 p-4 ring-1 ring-violet-100 dark:bg-violet-500/[0.06] dark:ring-violet-500/15">
            <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wider text-violet-900 dark:text-violet-200">
              <Cloud className="size-3.5" aria-hidden />
              {t('section4Title')}
            </h3>
            <p className="mb-2 text-[13px] leading-relaxed text-foreground/85">
              {t('section4Intro')}
            </p>
            <ul className="space-y-1.5 text-foreground/90">
              <BulletItem text={t('section4Bullet1')} dot="violet" />
              <BulletItem text={t('section4Bullet2')} dot="violet" />
              <BulletItem text={t('section4Bullet3')} dot="violet" />
              <BulletItem text={t('section4Bullet4')} dot="violet" />
            </ul>
          </section>

          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {t('reassurance')}
          </p>

          <div className="space-y-1 rounded-lg bg-muted/40 p-3 text-[12px] text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">
                {t('retentionLabel')}:
              </span>{' '}
              <span className="italic">{t('retentionTbd')}</span>
            </div>
            <div>{t('declineFootnote')}</div>
          </div>

          <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-card p-3.5 ring-1 ring-black/5 transition-colors active:bg-gray-50 dark:ring-white/10 dark:active:bg-white/5">
            <span
              className={`mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                checked
                  ? 'border-indigo-600 bg-indigo-600 text-white'
                  : 'border-gray-300 bg-card dark:border-white/15'
              }`}
            >
              {checked && <Check className="size-3.5" strokeWidth={3} />}
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="sr-only"
            />
            <span className="text-[15px] font-medium leading-snug text-foreground">
              {t('checkboxLabel')}
            </span>
          </label>
        </div>

        <DialogFooter className="flex-col gap-2 pt-3 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={handleDecline}
            className="h-12 w-full md:h-10 md:w-auto"
          >
            {t('decline')}
          </Button>
          <Button
            onClick={handleAgree}
            disabled={!checked}
            className="h-12 w-full bg-indigo-600 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-gray-300 md:h-10 md:w-auto"
          >
            {t('agree')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Bullet — muted (gray) for sections 1+2, indigo for Layer-1
// section 3 (visual cue that those items are the "protected"
// content).
function BulletItem({
  text,
  dot,
}: {
  text: string
  dot: 'muted' | 'indigo' | 'violet'
}) {
  const color =
    dot === 'indigo'
      ? 'text-indigo-400 dark:text-indigo-300'
      : dot === 'violet'
        ? 'text-violet-400 dark:text-violet-300'
        : 'text-gray-400 dark:text-gray-500'
  return (
    <li className="flex gap-2">
      <span className={`shrink-0 ${color}`}>•</span>
      <span>{text}</span>
    </li>
  )
}
