'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ConsentCheckCard } from '@synqed-kk/ui'
import { toast } from 'sonner'

import { useRouter } from '@/i18n/navigation'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { ReviewScreen } from '@/components/review/ReviewScreen'
import { globalPipeline } from '@/lib/global-pipeline'
import { useGlobalPipeline } from '@/hooks/use-global-pipeline'
import { useTimetableStore } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import {
  getCustomerConsent,
  grantCustomerConsent,
} from '@/actions/customers'
import { isConsentCurrent } from '@/lib/consent'

import { RecordPageHeader } from './RecordPageHeader'
import {
  RecordingTargetCard,
  type RecordTargetAppointment,
  type RecordTargetBooking,
} from './RecordingTargetCard'
import {
  PreSessionBriefCard,
  type PreSessionBrief,
} from './PreSessionBriefCard'
import { SourceModeChips } from './SourceModeChips'
import { RecordButtonCard } from './RecordButtonCard'
import { ConsentPill } from './ConsentPill'
import {
  RecentRecordingsCard,
  type RecentRecording,
} from './RecentRecordingsCard'
import { LiveTranscriptCard } from './LiveTranscriptCard'
import { PostSessionResolutionDialog } from './PostSessionResolutionDialog'
import { RepurchaseCueBanner } from './RepurchaseCueBanner'
import { redeemSessionAction, undoRedemptionAction } from '@/actions/packs'
import { resolveOutcomeMode } from '@/lib/packs/resolve'
import type { SessionOutcome } from '@/lib/karute/outcome-types'

export interface RecordPageNextAppointment {
  id: string
  customerName: string
  customerId: string
  /** Sequential karute number ("#00007") — matches the 顧客/予約 surfaces. */
  karuteNumber: string | null
  startTime: string
  durationMinutes: number
  title: string | null
  notes: string | null
  /** Server-derived status at render time. Decouples this client
   *  component from `Date.now()` (which React Compiler flags as
   *  impure during render). Re-derive on the next server render
   *  if the page is revisited. */
  statusKey?: 'in-session' | 'booked' | 'done' | 'walk-in'
  /** Resolved staff display name for the recording-target card. Server
   *  looks it up from the staff list at render time (the appointment
   *  query already selects staff_profile_id). Earlier version hardcoded
   *  '—' even when staff_profile_id was set. */
  staffName?: string
}

export interface RecordPageViewProps {
  customers: CustomerOption[]
  locale: string
  nextAppointment: RecordPageNextAppointment | null
  nearbyBookings: RecordTargetBooking[]
  brief: PreSessionBrief | null
  recentRecordings: RecentRecording[]
  /** Pre-formatted "Mar 12, 2026" (or locale equivalent). */
  consentDate: string | null
  /** The target customer's active 回数券 (sessions remaining) — drives the
   *  one-tap 消化 row in the post-session outcome dialog (design #1). */
  targetPack?: { id: string; remaining: number; size: number } | null
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatHHMM(d: Date): string {
  // Pin to JST so the time-range pill ("11:30–12:30") matches the booking
  // dialog input regardless of where the renderer is running.
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function RecordPageView({
  customers,
  locale,
  nextAppointment,
  nearbyBookings,
  brief,
  recentRecordings,
  consentDate,
  targetPack = null,
}: RecordPageViewProps) {
  const t = useTranslations('recording')
  const tc = useTranslations('common')
  const tPacks = useTranslations('customers.profile.packs')
  const recordingAppointmentId = useTimetableStore((s) => s.recordingAppointmentId)
  const recordingCustomerId = useTimetableStore((s) => s.recordingCustomerId)

  const {
    state: recState,
    result,
    error: micError,
    stream,
    startedAt,
    overrun,
    autoStopped,
    startRecording,
    stopRecording,
    discardRecording,
  } = useGlobalRecorder()

  // Background AI pipeline (transcribe → extract → summarize). Module-level
  // singleton — survives navigation; the top-corner chip (ProcessingIndicator)
  // shows progress instead of a full-screen blocker.
  const pipeline = useGlobalPipeline()

  // Runaway-recording safety nets (see global-recorder): nudge the staff when a
  // recording runs unusually long, and tell them when the hard cap auto-saved it.
  useEffect(() => {
    if (overrun) toast.warning(t('overrunWarning'))
  }, [overrun, t])
  useEffect(() => {
    if (autoStopped) toast.info(t('autoStopped'))
  }, [autoStopped, t])

  // 別の予約を選択: tapping a booking in the picker re-targets the record page
  // at THAT appointment. We push the id through `?appointmentId` so the server
  // component (sessions/page.tsx) re-resolves the target — same mechanism the
  // 予約 agenda uses (BookingActionSheetWrapper.goToRecord). `replace` keeps the
  // back button pointed at where the user came from instead of stacking every
  // switch. Without this handler the sheet opened but selecting a row was a
  // no-op (onSwitchBooking?.() swallowed silently) — "the button is broken".
  const router = useRouter()
  const handleSwitchBooking = useCallback(
    (booking: RecordTargetBooking) => {
      router.replace(
        {
          pathname: '/sessions',
          query: { appointmentId: booking.id },
        } as Parameters<typeof router.replace>[0],
      )
    },
    [router],
  )

  type Phase = 'idle' | 'recording' | 'recorded'
  const [phase, setPhase] = useState<Phase>(() => {
    if (recState === 'recording' || recState === 'paused') return 'recording'
    if (recState === 'recorded') return 'recorded'
    return 'idle'
  })
  const [showNoBookingPrompt, setShowNoBookingPrompt] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  // Outcome is chosen the MOMENT recording stops (the staff knows it live),
  // before transcription — so they decide once, up front, then the AI runs in
  // the background while they move on. It rides the pipeline context to save.
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  const [consent, setConsent] = useState<{ granted: boolean; grantedAt: string | null } | null>(null)
  const [showConsentDialog, setShowConsentDialog] = useState(false)
  const [consentSubmitting, setConsentSubmitting] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)

  const customerIdForConsent = nextAppointment?.customerId ?? null
  const refreshConsent = useCallback(async () => {
    if (!customerIdForConsent) {
      setConsent(null)
      return
    }
    try {
      const { consent: row } = await getCustomerConsent(customerIdForConsent)
      // Stale-version consent must NOT count as granted (legal invalidation).
      setConsent({ granted: isConsentCurrent(row), grantedAt: row?.granted_at ?? null })
    } catch {
      setConsent({ granted: false, grantedAt: null })
    }
  }, [customerIdForConsent])
  useEffect(() => {
    refreshConsent()
  }, [refreshConsent])

  async function handleGrantConsent() {
    if (!customerIdForConsent) return
    setConsentSubmitting(true)
    setConsentError(null)
    const r = await grantCustomerConsent(customerIdForConsent, { method: 'VERBAL' })
    setConsentSubmitting(false)
    if (!r.ok) {
      setConsentError(r.error)
      return
    }
    setShowConsentDialog(false)
    await refreshConsent()
  }

  const consentRequired = !!customerIdForConsent
  const consentGranted = consent?.granted ?? false
  const recordingBlocked = consentRequired && !consentGranted

  const bars = useWaveformBars(stream, recState === 'recording')
  const normalizedBars = bars.map((h) => Math.max(0.15, Math.min(1, h / 100)))
  const [frozenBars, setFrozenBars] = useState<number[]>([])
  useEffect(() => {
    if (recState === 'recording') setFrozenBars(bars)
  }, [recState, bars])

  // Sync global recorder state to local phase
  useEffect(() => {
    if (recState === 'recording' || recState === 'paused') {
      setPhase('recording')
    } else if (recState === 'recorded' && result) {
      setRecordingDuration(Math.round(result.durationMs / 1000))
      setPhase('recorded')
    } else if (recState === 'idle') {
      setPhase('idle')
    }
  }, [recState, result])

  const elapsed = useElapsed(recState, startedAt)

  function handleStartRecording() {
    if (!nextAppointment) {
      setShowNoBookingPrompt(true)
      return
    }
    startRecording()
  }
  function handleStartAnyway() {
    setShowNoBookingPrompt(false)
    startRecording()
  }
  function handleDiscard() {
    discardRecording()
    setPhase('idle')
  }
  function handleUseRecording(outcome?: SessionOutcome, outcomeSkipped = false) {
    if (!result) return
    // Hand the take to the BACKGROUND pipeline (was: a full-screen blocking
    // modal on this page). The top-corner chip shows progress; staff can leave
    // and keep working. When it's done the chip brings them back to review+save.
    // The outcome (chosen at stop) rides along so the save applies it without
    // re-prompting at the end.
    // `|| undefined`: a walk-in target (customer recorded with no booking)
    // carries id='' — coerce it so the save writes appointment_id null, not ''.
    const effectiveAppointmentId =
      (recordingAppointmentId ?? nextAppointment?.id) || undefined
    const effectiveCustomerId = recordingAppointmentId
      ? (recordingCustomerId ?? undefined)
      : nextAppointment?.customerId
    globalPipeline.start(result.blob, {
      locale,
      customers,
      duration: Math.round(result.durationMs / 1000),
      appointmentId: effectiveAppointmentId,
      appointmentCustomerId: effectiveCustomerId,
      outcome,
      outcomeSkipped,
    })
    // The pipeline now owns the audio; clear the recorder + return to idle so
    // the page isn't stuck on the "review your take" screen.
    discardRecording()
    setPhase('idle')
  }
  function handleNewSession() {
    discardRecording()
    setPhase('idle')
  }

  // What the stop flow shows, decided by the pack state (single source —
  // resolveOutcomeMode): conversion dialog / repurchase dialog / nothing at all.
  const outcomeMode = resolveOutcomeMode(targetPack)

  // Mid-pack ZERO-TAP flow: the customer already paid and keeps rebooking — no
  // conversion conversation happened, so asking 成約/不成約 would pollute the
  // coaching labels. Consume 1 session (undo-able toast) + autosave without an
  // outcome row.
  function handleAutoFlow() {
    if (targetPack && nextAppointment?.customerId) {
      const from = targetPack.remaining
      void redeemSessionAction({
        packId: targetPack.id,
        customerId: nextAppointment.customerId,
      }).then((res) => {
        if (res.ok) {
          toast.success(
            tPacks('autoRedeemed', { from, to: from - 1 }),
            res.redemptionId
              ? {
                  action: {
                    label: tPacks('undo'),
                    onClick: () =>
                      void undoRedemptionAction(res.redemptionId!).then((u) =>
                        u.ok
                          ? toast.success(tPacks('undone'))
                          : toast.error(tPacks('redeemFailed')),
                      ),
                  },
                }
              : undefined,
          )
        } else {
          toast.error(tPacks('redeemFailed'))
        }
      })
    }
    handleUseRecording(undefined, true)
  }

  // Background pipeline finished → render the SAME ReviewScreen the old
  // blocking flow used, fed from the singleton's result + the context captured
  // at start. The top-corner chip routes here when it's ready.
  if (pipeline.state === 'review' && pipeline.result && pipeline.context) {
    return (
      <ReviewScreen
        transcript={pipeline.result.transcript}
        entries={pipeline.result.entries}
        summary={pipeline.result.summary}
        customers={pipeline.context.customers}
        duration={pipeline.context.duration}
        appointmentId={pipeline.context.appointmentId}
        appointmentCustomerId={pipeline.context.appointmentCustomerId}
        outcome={pipeline.context.outcome}
        onSaved={() => {
          globalPipeline.reset()
          handleNewSession()
        }}
        onDiscard={() => {
          globalPipeline.reset()
          handleNewSession()
        }}
      />
    )
  }

  // Background pipeline errored → non-blocking inline card (retry/discard).
  if (pipeline.state === 'error') {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <div className="rounded-2xl border border-red-500/30 bg-card p-6 text-center shadow-sm">
          <p className="text-sm font-medium text-foreground">
            {pipeline.error ?? ''}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => globalPipeline.reset()}
              className="rounded-lg border border-border px-5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {tc('cancel')}
            </button>
            <button
              type="button"
              onClick={() => globalPipeline.retry()}
              className="rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {tc('retry')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Map nextAppointment to the target card shape. Status key comes
  // from the server (sessions/page.tsx derives it from now vs the
  // appointment window — keeps this client component pure for
  // React Compiler). 新規 (isFirstTimeVisit) flows from the brief.
  const targetAppointment: RecordTargetAppointment | null = nextAppointment
    ? {
        id: nextAppointment.id,
        customerName: nextAppointment.customerName,
        initials: deriveInitials(nextAppointment.customerName),
        karuteNumber: nextAppointment.karuteNumber ?? null,
        service: nextAppointment.title ?? '—',
        timeRange: (() => {
          const start = new Date(nextAppointment.startTime)
          const end = new Date(
            start.getTime() + nextAppointment.durationMinutes * 60_000,
          )
          return `${formatHHMM(start)}–${formatHHMM(end)}`
        })(),
        // Real staffName threaded from sessions/page.tsx via the
        // staff list lookup. Earlier the value was hardcoded '—'
        // even though staff_profile_id was selected on the
        // appointment row.
        staffName: nextAppointment.staffName ?? '—',
        statusKey: nextAppointment.statusKey ?? 'booked',
        isNew: brief?.isFirstTimeVisit ?? false,
      }
    : null

  const isRecording = phase === 'recording'
  // When there's no booking, the empty-state target card is a small banner —
  // collapse to a single column so the record button isn't dwarfed by a half-empty grid.
  const layoutMode: 'single' | 'split' = targetAppointment ? 'split' : 'single'

  const recorderControls = phase === 'recorded' ? (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
      <div className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {`${pad2(Math.floor(recordingDuration / 60))}:${pad2(recordingDuration % 60)}`}
      </div>
      <div className="flex h-10 items-end gap-[3px] opacity-50">
        {frozenBars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full bg-muted-foreground/50"
            style={{ height: `${Math.max(15, Math.min(100, h * 0.6))}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex w-full items-center gap-3">
        <Button variant="outline" size="md" className="flex-1" onClick={handleDiscard}>
          {t('discard')}
        </Button>
        <Button
          variant="default"
          size="md"
          className="flex-1"
          onClick={() =>
            outcomeMode === 'auto' ? handleAutoFlow() : setOutcomeOpen(true)
          }
        >
          {t('useRecording')}
        </Button>
      </div>
    </section>
  ) : (
    <RecordButtonCard
      customerName={nextAppointment?.customerName ?? null}
      isRecording={isRecording}
      elapsedSeconds={elapsed}
      waveform={normalizedBars}
      onStart={() => {
        if (recordingBlocked) return
        handleStartRecording()
      }}
      onStop={stopRecording}
    />
  )

  const recorderColumn = (
    <div className="flex flex-col gap-3.5">
      <SourceModeChips />
      {recorderControls}
      <div className="flex justify-center">
        <ConsentPill consentDate={consentDate} />
      </div>
      {phase === 'idle' && nextAppointment && consent && !consent.granted && (
        <ConsentCheckCard
          consented={false}
          customerName={nextAppointment.customerName}
          labels={{
            grantedTitle: t('consentGrantedTitle'),
            grantedDesc: t('consentGrantedDesc'),
            grantedWhen: t('consentGrantedWhen'),
            missingTitle: t('consentMissingTitle'),
            missingDesc: t('consentMissingDesc'),
            startFlow: t('consentStartFlow'),
          }}
          onStartConsent={() => {
            setConsentError(null)
            setShowConsentDialog(true)
          }}
        />
      )}
    </div>
  )

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <RecordPageHeader />

      {micError && (
        <div
          className="rounded-xl border px-4 py-3 text-sm"
          style={{
            borderColor: 'color-mix(in srgb, var(--color-destructive) 30%, transparent)',
            backgroundColor: 'color-mix(in srgb, var(--color-destructive) 10%, transparent)',
            color: 'var(--color-destructive)',
          }}
        >
          {t('micError')}
        </div>
      )}

      {layoutMode === 'split' ? (
        <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4 self-start">
            <RecordingTargetCard
              appointment={targetAppointment}
              nearbyBookings={nearbyBookings}
              onSwitchBooking={handleSwitchBooking}
            />
            <RepurchaseCueBanner pack={targetPack} />
            <PreSessionBriefCard
              brief={brief}
              customerName={nextAppointment?.customerName ?? null}
            />
          </div>
          <div className="self-start">{recorderColumn}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <RecordingTargetCard
            appointment={targetAppointment}
            nearbyBookings={nearbyBookings}
            onSwitchBooking={handleSwitchBooking}
          />
          <RepurchaseCueBanner pack={targetPack} />
          <PreSessionBriefCard
            brief={brief}
            customerName={nextAppointment?.customerName ?? null}
          />
          <div className="mx-auto w-full max-w-md">{recorderColumn}</div>
        </div>
      )}

      <LiveTranscriptCard connected={false} lines={[]} />

      <RecentRecordingsCard recordings={recentRecordings} />

      {/* Outcome — chosen at stop, BEFORE transcription, so staff aren't stuck
          waiting for the AI. Centered pop-up; the choice rides the pipeline
          context to the save. */}
      <PostSessionResolutionDialog
        open={outcomeOpen}
        customerName={nextAppointment?.customerName ?? ''}
        isFirstVisit={brief?.isFirstTimeVisit ?? false}
        mode={outcomeMode === 'repurchase' ? 'repurchase' : 'conversion'}
        pack={targetPack}
        onCancel={() => setOutcomeOpen(false)}
        onResolve={(outcome, redeemPack) => {
          setOutcomeOpen(false)
          // Redemption records the VISIT (which already happened), so it fires
          // immediately — independent of whether the transcription/save later
          // succeeds. Failure → toast; the profile pack card is the fallback.
          if (redeemPack && targetPack && nextAppointment?.customerId) {
            void redeemSessionAction({
              packId: targetPack.id,
              customerId: nextAppointment.customerId,
            }).then((res) => {
              if (res.ok) toast.success(tPacks('redeemDone'))
              else toast.error(tPacks('redeemFailed'))
            })
          }
          // 購入した → close the loop: the NEW pack must be registered, or the
          // alert system keeps treating them as nearly-out. One tap to the
          // profile's 登録 dialog.
          if (
            outcomeMode === 'repurchase' &&
            outcome.status === 'success' &&
            nextAppointment?.customerId
          ) {
            const customerId = nextAppointment.customerId
            toast.success(t('registerNewPackPrompt'), {
              duration: 10_000,
              action: {
                label: t('registerNewPackAction'),
                onClick: () =>
                  router.push(
                    `/customers/${customerId}` as Parameters<typeof router.push>[0],
                  ),
              },
            })
          }
          handleUseRecording(outcome)
        }}
      />

      {/* Consent dialog */}
      {showConsentDialog && nextAppointment && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !consentSubmitting && setShowConsentDialog(false)}
          />
          <div
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl bg-card p-6 shadow-xl ring-1 ring-border"
          >
            <h3 className="text-base font-semibold text-foreground">{t('consentDialogTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('consentDialogInstructions')}</p>
            <div className="rounded-md bg-muted p-4 text-sm leading-relaxed text-foreground">
              {t('consentScript', { customerName: nextAppointment.customerName })}
            </div>
            {consentError && <p className="text-sm text-destructive">{consentError}</p>}
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setShowConsentDialog(false)}
                disabled={consentSubmitting}
              >
                {tc('cancel')}
              </Button>
              <Button
                variant="default"
                size="md"
                className="flex-1"
                onClick={handleGrantConsent}
                disabled={consentSubmitting}
              >
                {consentSubmitting ? tc('saving') : t('consentConfirmButton')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* No-booking prompt */}
      {showNoBookingPrompt && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowNoBookingPrompt(false)}
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-base font-semibold text-foreground">{t('noBookingTitle')}</h3>
            <p className="text-sm text-muted-foreground">{t('noBookingDescription')}</p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setShowNoBookingPrompt(false)}
              >
                {tc('cancel')}
              </Button>
              <Button
                variant="default"
                size="md"
                className="flex-1"
                onClick={handleStartAnyway}
              >
                {t('recordAnyway')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function useElapsed(recState: string, startedAt: number | null): number {
  const [seconds, setSeconds] = useState(() => {
    if (recState === 'recording' && startedAt) {
      return Math.floor((Date.now() - startedAt) / 1000)
    }
    return 0
  })
  useEffect(() => {
    if (recState !== 'recording') return
    const id = setInterval(() => {
      if (startedAt) setSeconds(Math.floor((Date.now() - startedAt) / 1000))
      else setSeconds((s) => s + 1)
    }, 1000)
    return () => clearInterval(id)
  }, [recState, startedAt])
  useEffect(() => {
    if (recState === 'idle') setSeconds(0)
  }, [recState])
  return seconds
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
