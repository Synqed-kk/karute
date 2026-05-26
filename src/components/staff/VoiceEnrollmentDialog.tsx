'use client'

// LIFTED FROM SPIKE (visual + flow, recording is a STUB)
//   src: /Users/liam/Documents/synqed-karute-design-spike/src/components/settings/VoiceEnrollmentDialog.tsx
//
// 3-step opt-in voice enrollment for a staff member:
//
//   1. CONSENT — privacy disclosure card + biometric notice card +
//      "I understand and agree" checkbox. 次へ disabled until checked.
//   2. RECORD  — phrase to read aloud + mic button + 00:00/00:15 timer.
//      Tap mic → counts up to 15s → auto-completes. Tap mic again
//      during recording to stop early.
//   3. COMPLETE — green check + confirmation + "you can delete any time"
//      reassurance + 完了 button.
//
// PRIVACY POSTURE — straight from the spike + the spike's
// SPEAKER_RECOGNITION_AND_RECORDING_LAW.md doc:
//   • Raw audio is discarded after the 256-dim embedding is computed.
//     ONLY the embedding persists (NEVER the audio).
//   • Embedding is biometric data under APPI. Encrypted storage,
//     RLS-locked to server-side diarization jobs only.
//   • Enrollment is fully OPT-IN. Diarization works without it
//     via the "first speaker = staff" heuristic.
//   • Staff can revoke any time → clears embedding + audit row
//     within 30 days.
//
// WHAT'S STUBBED in this PR (Anthony's `function` branch picks up):
//   - startRecording() currently just starts a 1-second-tick timer.
//     Real impl: kick off MediaRecorder (web) / Capacitor audio
//     recorder (native). Cap at 20s max. Stream chunks if needed.
//   - On stop, the audio Blob is currently DISCARDED with no
//     processing. Real impl: POST blob to
//     `/api/voice/enroll` → server calls compute-voice-embedding
//     edge function → writes (staff.voice_enrolled_at,
//     staff.voice_embedding) → returns the iso timestamp.
//   - onEnrolled callback fires with a synthetic timestamp so the
//     UI flow demonstrates end-to-end (consent → record → complete →
//     row chip flips to 声登録済). Replace the synthetic timestamp
//     with the server-returned one when wired.
//
// FILES THE SPIKE REFERENCES for the wiring:
//   docs/SPEAKER_RECOGNITION_AND_RECORDING_LAW.md
//     §"Voice enrollment" — full contract + APPI notes
//     §"Staff voice matching — MVP heuristic vs. embedding matching"
//       — why this is OPTIONAL and karute can launch without it
//   The 5 Supabase mutations are inline in the spike's VoiceEnrollmentDialog
//   header comment — see the karute MERGE_NOTES_FOR_ANTHONY.md
//   "Staff voice enrollment" section for the lift.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  AlertTriangle,
  CheckCircle2,
  Mic,
  ShieldCheck,
  Square,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type Step = 'consent' | 'recording' | 'complete'

interface Props {
  open: boolean
  onClose: () => void
  staffName: string
  /** Fires when enrollment completes with the recorded-at ISO timestamp.
   *  Today the timestamp is synthesized client-side; once Anthony wires
   *  the real POST → embedding pipeline, this should be the
   *  server-returned `voice_enrolled_at`. */
  onEnrolled?: (enrolledAt: string) => void
}

const RECORD_TARGET_SECONDS = 15

export function VoiceEnrollmentDialog({
  open,
  onClose,
  staffName,
  onEnrolled,
}: Props) {
  const t = useTranslations('voiceEnrollment')
  const [step, setStep] = useState<Step>('consent')
  const [consentChecked, setConsentChecked] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [isRecording, setIsRecording] = useState(false)

  // Tick while recording + auto-stop at target. Threshold check lives
  // inside the functional updater so we don't need a separate effect
  // to observe recordingSeconds — avoids the react-hooks set-state-in-
  // effect lint pattern.
  useEffect(() => {
    if (!isRecording) return
    const id = window.setInterval(() => {
      setRecordingSeconds((s) => {
        const next = s + 1
        if (next >= RECORD_TARGET_SECONDS) {
          // Defer the state-mutating stop to the next tick so we're not
          // calling setState synchronously inside a setter.
          window.setTimeout(() => {
            setIsRecording(false)
            setStep('complete')
            const enrolledAt = new Date().toISOString()
            onEnrolled?.(enrolledAt)
          }, 0)
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [isRecording, onEnrolled])

  function reset() {
    setStep('consent')
    setConsentChecked(false)
    setRecordingSeconds(0)
    setIsRecording(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function startRecording() {
    // ANTHONY: replace this stub with MediaRecorder (web) or the
    // Capacitor audio-recorder (native). The tick is just visual
    // feedback for the spike-aligned UI. See the function-branch
    // entry in MERGE_NOTES_FOR_ANTHONY.md for the full wiring path.
    setRecordingSeconds(0)
    setIsRecording(true)
  }

  function stopRecording() {
    setIsRecording(false)
    setStep('complete')
    const enrolledAt = new Date().toISOString()
    onEnrolled?.(enrolledAt)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Mic className="size-4 text-blue-600" aria-hidden />
            {t('title')}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {t('description', { name: staffName })}
          </DialogDescription>
        </DialogHeader>

        {/* ─────────────────────────────────────────────────────────
         *  STEP 1 — CONSENT
         *  ───────────────────────────────────────────────────────── */}
        {step === 'consent' && (
          <div className="space-y-3 py-2">
            {/* Privacy bullets */}
            <div className="rounded-md bg-blue-50/70 p-3 text-[12px] leading-relaxed text-blue-900 ring-1 ring-blue-200/70 dark:bg-blue-500/10 dark:text-blue-200 dark:ring-blue-500/20">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <ShieldCheck className="size-3.5" aria-hidden />
                {t('privacyTitle')}
              </div>
              <ul className="list-inside list-disc space-y-1">
                <li>{t('privacyItem1')}</li>
                <li>{t('privacyItem2')}</li>
                <li>{t('privacyItem3')}</li>
                <li>{t('privacyItem4')}</li>
              </ul>
            </div>

            {/* Biometric warning */}
            <div className="flex items-start gap-2 rounded-md bg-amber-50/70 p-3 text-[11px] leading-relaxed text-amber-900 ring-1 ring-amber-200/70 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <div>{t('biometricNotice')}</div>
            </div>

            {/* Consent checkbox */}
            <label className="flex cursor-pointer select-none items-start gap-2">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-blue-600"
              />
              <span className="text-[13px] leading-relaxed text-foreground">
                {t('consentCheck')}
              </span>
            </label>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────
         *  STEP 2 — RECORDING
         *  ───────────────────────────────────────────────────────── */}
        {step === 'recording' && (
          <div className="space-y-4 py-4">
            <p className="text-sm leading-relaxed text-foreground/90">
              {t('recordInstruction')}
            </p>

            {/* Phrase to read */}
            <div className="rounded-md bg-gray-50 p-4 text-[14px] italic leading-relaxed text-foreground/95 ring-1 ring-gray-200 dark:bg-white/[0.04] dark:ring-white/10">
              「{t('phraseToRead')}」
            </div>

            {/* Mic button + timer */}
            <div className="flex flex-col items-center gap-3">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  className="flex size-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-500/30 transition-colors hover:bg-red-700"
                  aria-label={t('startRecord')}
                >
                  <Mic className="size-6" />
                </button>
              ) : (
                <div className="relative">
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="relative z-10 flex size-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg shadow-red-500/30"
                    aria-label={t('stopRecord')}
                  >
                    <Square className="size-5" fill="currentColor" />
                  </button>
                  <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
                </div>
              )}
              <div className="text-[20px] font-semibold tabular-nums text-foreground">
                {String(Math.floor(recordingSeconds / 60)).padStart(2, '0')}:
                {String(recordingSeconds % 60).padStart(2, '0')} /{' '}
                {String(Math.floor(RECORD_TARGET_SECONDS / 60)).padStart(2, '0')}:
                {String(RECORD_TARGET_SECONDS % 60).padStart(2, '0')}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {isRecording ? t('recordingHint') : t('readyHint')}
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────
         *  STEP 3 — COMPLETE
         *  ───────────────────────────────────────────────────────── */}
        {step === 'complete' && (
          <div className="space-y-3 py-4">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
              <CheckCircle2 className="size-5" aria-hidden />
              <span className="text-base font-semibold">
                {t('completeTitle')}
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">
              {t('completeBody', { name: staffName })}
            </p>
            <div className="rounded-md bg-gray-50 p-3 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-gray-200 dark:bg-white/[0.04] dark:ring-white/10">
              {t('revokeHint')}
            </div>
          </div>
        )}

        {/* Footer — buttons swap per step */}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          {step === 'consent' && (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                className="w-full sm:w-auto"
              >
                {t('cancel')}
              </Button>
              <Button
                onClick={() => setStep('recording')}
                disabled={!consentChecked}
                className="w-full sm:w-auto"
              >
                {t('proceed')}
              </Button>
            </>
          )}
          {step === 'recording' && !isRecording && (
            <Button
              variant="outline"
              onClick={() => setStep('consent')}
              className="w-full"
            >
              {t('back')}
            </Button>
          )}
          {step === 'complete' && (
            <Button onClick={handleClose} className="w-full">
              <CheckCircle2 className="mr-1.5 size-3.5" />
              {t('done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
