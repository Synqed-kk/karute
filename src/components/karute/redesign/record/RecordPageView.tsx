'use client'

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ConsentCheckCard } from '@synqed-kk/ui'
import { toast } from 'sonner'

import { useRouter } from '@/i18n/navigation'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { ReviewScreen } from '@/components/review/ReviewScreen'
import type { Entry } from '@/types/ai'
import { loadDraft, clearDraft, type KaruteDraft } from '@/lib/karute/draft'
import {
  deleteTake,
  getRecoverableTake,
  loadTakeBlob,
  type RecoverableTake,
} from '@/lib/karute/take-store'
import { globalRecorder } from '@/lib/global-recorder'
import { globalPipeline } from '@/lib/global-pipeline'
import { useGlobalPipeline } from '@/hooks/use-global-pipeline'
import { useTimetableStore } from '@/stores/timetable-store'
import type { CustomerOption } from '@/components/karute/CustomerCombobox'
import {
  getCustomerConsent,
  grantCustomerConsent,
  deleteCustomerPhoto,
} from '@/actions/customers'
import { isConsentCurrent } from '@/lib/consent'
import { sessionPhotoStore } from '@/lib/karute/session-photos'

import { RecordPageHeader } from './RecordPageHeader'
import { PipelineErrorCard } from './PipelineErrorCard'
import {
  RecordingTargetCard,
  type RecordTargetAppointment,
  type RecordTargetBooking,
} from './RecordingTargetCard'
import {
  PreSessionBriefCard,
  type PreSessionBrief,
} from './PreSessionBriefCard'
// type-only: erased at compile time, so ai-brief.ts's `server-only` guard never
// runs in this client module.
import type { PreSessionBriefResult } from '@/lib/karute/ai-brief'
import { SourceModeChips } from './SourceModeChips'
import { RecordButtonCard } from './RecordButtonCard'
import { SessionPhotoCard } from './SessionPhotoCard'
import { ConsentPill } from './ConsentPill'
import { RecordingConsentDialog } from './RecordingConsentDialog'
import {
  RecentRecordingsCard,
  type RecentRecording,
} from './RecentRecordingsCard'
import { LiveTranscriptCard } from './LiveTranscriptCard'
import {
  PostSessionResolutionDialog,
  type NewPackInput,
} from './PostSessionResolutionDialog'
import type { PackPreset } from '@/actions/org-settings'
import { RepurchaseCueBanner } from './RepurchaseCueBanner'
import {
  createPackAction,
  redeemSessionAction,
  undoRedemptionAction,
} from '@/actions/packs'
import { resolveOutcomeMode } from '@/lib/packs/resolve'
import {
  deriveInitials,
  formatTimeRange,
  liveTargetCardAppointment,
} from './live-target-appointment'
import type { SessionOutcome } from '@/lib/karute/outcome-types'
import type { VisitSegment, VisitRhythm } from '@/lib/visits/segment'
import { VisitRhythmPanel } from '@/components/visits/VisitRhythmPanel'
import { ClosingTacticHint } from '@/components/visits/ClosingTacticHint'

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
  /** True when the selected customer is booked under a DIFFERENT staff than
   *  the signed-in user — drives the 別のスタッフの予約 heads-up banner. */
  bookedUnderOtherStaff?: boolean
}

export interface RecordPageViewProps {
  customers: CustomerOption[]
  locale: string
  nextAppointment: RecordPageNextAppointment | null
  nearbyBookings: RecordTargetBooking[]
  brief: PreSessionBrief | null
  /** Un-awaited AI brief — streamed in; the brief card upgrades when it
   *  resolves. Resolves to null when there's no target / the AI had no signal /
   *  the AI call failed (the card then stays on the mechanical `brief`). */
  aiBriefPromise: Promise<PreSessionBriefResult | null>
  recentRecordings: RecentRecording[]
  /** Pre-formatted "Mar 12, 2026" (or locale equivalent). */
  consentDate: string | null
  /** Recording target's visit-frequency segment (常連/安定/離脱気味/新規) — same
   *  classifyVisitSegment the customer profile uses. Drives ClosingTacticHint;
   *  null when there's no target or a terminal lifecycle decision owns them. */
  visitSegment?: VisitSegment | null
  /** Rhythm-bar geometry (days since last visit vs. usual interval) — same
   *  computeVisitRhythm the customer profile's cadence math uses. Drives
   *  VisitRhythmPanel; null without enough dated history. */
  visitRhythm?: VisitRhythm | null
  /** Whether the recording target holds a 回数券 — gates ClosingTacticHint's
   *  pack vs. no-pack tactic line. */
  targetHasTicketPack?: boolean
  /** The target customer's active 回数券 (sessions remaining) — drives the
   *  one-tap 消化 row in the post-session outcome dialog (design #1). */
  targetPack?: { id: string; remaining: number; size: number } | null
  /** Owner presets + permission for the 新しい回数券 panel (設定 → 回数券). */
  packPresets?: PackPreset[]
  staffCanCustomizePacks?: boolean
  /** The customer's most recent pack (any status) — the picker prefill. */
  previousPack?: { size: number; unitPrice: number } | null
  /** Org 録音設定 noise-suppression toggle (default on) — applied to the mic. */
  noiseSuppression?: boolean
  /** Signed-in staff display name — shown in the 別のスタッフの予約 banner so
   *  staff see the record will save under THEM. */
  currentStaffName?: string | null
  /** Org-level 回数券 master switch. Off → the stop flow neither burns a
   *  session nor opens the outcome dialog (成約/回数券 questions are ticket
   *  economics) — it saves the record exactly like the mid-pack auto path,
   *  minus the redemption. */
  ticketsEnabled?: boolean
}

export function RecordPageView({
  customers,
  locale,
  nextAppointment,
  nearbyBookings,
  brief,
  aiBriefPromise,
  recentRecordings,
  consentDate,
  visitSegment = null,
  visitRhythm = null,
  targetHasTicketPack = false,
  targetPack = null,
  packPresets = [],
  staffCanCustomizePacks = true,
  previousPack = null,
  noiseSuppression = true,
  currentStaffName = null,
  ticketsEnabled = true,
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
    target,
    takeId: activeTakeId,
    startRecording,
    stopRecording,
    discardRecording,
    awaitRecordingSessionId,
  } = useGlobalRecorder()

  // Background AI pipeline (transcribe → extract → summarize). Module-level
  // singleton — survives navigation; the top-corner chip (ProcessingIndicator)
  // shows progress instead of a full-screen blocker.
  const pipeline = useGlobalPipeline()

  const live = recState !== 'idle' || pipeline.state !== 'idle'
  // Single source of truth for who the audio is bound to. `target` is captured
  // at recording start and is null when idle, so this naturally yields the
  // bound customer while recording and the next booking when idle — and can
  // NEVER drift to a different customer on navigation the way nextAppointment does.
  const boundCustomerId = target?.customerId ?? nextAppointment?.customerId
  const boundAppointmentId = (target?.appointmentId ?? nextAppointment?.id) || undefined
  const boundCustomerName = (live && target ? target.customerName : nextAppointment?.customerName) ?? null

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
      // Switching the target mid-recording would desync the bound customer from
      // the booking shown — a no-op while live keeps the audio's binding intact.
      if (live) return
      // String href, not the {pathname, query} object: next-intl's router takes
      // both, but the thin nav shim (nav.vite) is History-API string-only — the
      // object form serialized to "[object Object]" in the thin app.
      router.replace(`/sessions?appointmentId=${encodeURIComponent(booking.id)}`)
    },
    [router, live],
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

  // D3: discard-with-photos confirmation (see handleDiscard below).
  const [showDiscardPhotosDialog, setShowDiscardPhotosDialog] = useState(false)
  const [discardingPhotos, setDiscardingPhotos] = useState(false)

  // Re-entry + staleness guards for the use-recording flow (it awaits the
  // session-id mint, so it's no longer atomic): first tap wins, and a discard
  // bumps the generation so an in-flight use drops its now-discarded take.
  const usingRecording = useRef(false)
  const useRecordingGen = useRef(0)

  // Crash recovery: a draft persisted by ReviewScreen from a session that was
  // never saved (WebView killed, tab reloaded). Loaded after mount (client-only,
  // so no SSR hydration mismatch). `restoring` = the staffer chose to reopen it.
  const [recoveredDraft, setRecoveredDraft] = useState<KaruteDraft | null>(null)
  const [restoring, setRestoring] = useState(false)
  // Take recovery: persisted AUDIO from a session that never reached a saved
  // karute record (killed mid-recording, or reloaded mid-transcription before
  // any draft existed). A surviving draft is PREFERRED — its transcription is
  // already paid for — so the audio is offered only when no draft loads.
  const [recoveredTake, setRecoveredTake] = useState<RecoverableTake | null>(null)
  useEffect(() => {
    // Both loads are async and owner-gated at their store layer — only the
    // staff member who recorded/saved is ever offered anything (privacy on a
    // shared device). Guard against a late resolve after unmount. The live
    // recorder/pipeline take is excluded so an in-progress session is never
    // offered as its own recovery.
    let cancelled = false
    void Promise.all([
      loadDraft(),
      getRecoverableTake([globalRecorder.takeId, globalPipeline.context?.takeId]),
    ]).then(([d, tk]) => {
      if (cancelled) return
      setRecoveredDraft(d)
      setRecoveredTake(d ? null : tk)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const [consent, setConsent] = useState<{ granted: boolean; grantedAt: string | null } | null>(null)
  const [showConsentDialog, setShowConsentDialog] = useState(false)
  const [consentSubmitting, setConsentSubmitting] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)

  const customerIdForConsent = boundCustomerId ?? null
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
    // Transport failures must release the dialog, not wedge it (same class of
    // bug the review screen's consent confirm had — fixed in both places).
    let r: Awaited<ReturnType<typeof grantCustomerConsent>>
    try {
      r = await grantCustomerConsent(customerIdForConsent, { method: 'VERBAL' })
    } catch {
      setConsentSubmitting(false)
      setConsentError(tc('somethingWentWrong'))
      return
    }
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
    startRecording({
      noiseSuppression,
      // nextAppointment is guaranteed here (early-return above when it's null).
      target: {
        customerId: nextAppointment.customerId,
        customerName: nextAppointment.customerName,
        karuteNumber: nextAppointment.karuteNumber ?? null,
        appointmentId: nextAppointment.id || null,
        // Bind-time display snapshot — keeps the 録音対象 card's booking
        // pixels while live (field bug 7/29: the card degraded to 担当:—
        // for the whole recording once the live branch took over).
        service: nextAppointment.title,
        timeRange: formatTimeRange(
          nextAppointment.startTime,
          nextAppointment.durationMinutes,
        ),
        statusKey: nextAppointment.statusKey,
        isNew: brief?.isFirstTimeVisit ?? false,
      },
    })
  }
  function handleStartAnyway() {
    setShowNoBookingPrompt(false)
    // Reached only via the no-booking prompt → nextAppointment is null, so there
    // is no customer to bind (walk-in); the save will require picking one.
    startRecording({ noiseSuppression, target: null })
  }
  // D3 (Liam canon): discarding a recording that has session photos ASKS
  // EACH TIME — never silently drops or silently keeps them. target?.customerId
  // (not boundCustomerId) matches SessionPhotoCard's own mount/render filter
  // exactly, so this can never act on a stale/different customer's photos.
  function sessionDonePhotos() {
    const cid = target?.customerId
    if (!cid) return []
    return sessionPhotoStore.photos.filter(
      (p) => p.customerId === cid && p.status === 'done',
    )
  }

  function proceedDiscard() {
    // Invalidate any in-flight handleUseRecording: its post-await body must
    // not hand a take the staff just discarded to the pipeline.
    useRecordingGen.current++
    discardRecording()
    setPhase('idle')
  }

  function handleDiscard() {
    if (sessionDonePhotos().length > 0) {
      setShowDiscardPhotosDialog(true)
      return
    }
    proceedDiscard()
  }

  async function handleDiscardDeletePhotos() {
    const donePhotos = sessionDonePhotos()
    setShowDiscardPhotosDialog(false)
    setDiscardingPhotos(true)
    // Best-effort: collect failures, one toast if any fail — deleteCustomerPhoto
    // never throws (catches internally), so Promise.all is safe here.
    const results = await Promise.all(
      donePhotos.map((p) => deleteCustomerPhoto(p.customerId, p.serverId as string)),
    )
    setDiscardingPhotos(false)
    const failed = results.filter((r) => !r.success).length
    if (failed > 0) toast.error(t('sessionPhotos.discardDeleteFailed', { n: failed }))
    proceedDiscard()
  }

  function handleDiscardKeepPhotos() {
    setShowDiscardPhotosDialog(false)
    proceedDiscard()
  }
  async function handleUseRecording(outcome?: SessionOutcome, outcomeSkipped = false) {
    if (!result) return
    // Re-entry guard. handleUseRecording gained an await (the session-id
    // mint), opening a real window where a double-tap — or 自動 mode's
    // handleAutoFlow, which ALSO burns a pack session — could run twice for
    // one take. First entry wins; the generation check after the await
    // catches a discard racing an in-flight use.
    if (usingRecording.current) return
    usingRecording.current = true
    const gen = ++useRecordingGen.current
    try {
      // Hand the take to the BACKGROUND pipeline (was: a full-screen blocking
      // modal on this page). The top-corner chip shows progress; staff can leave
      // and keep working. When it's done the chip brings them back to review+save.
      // The outcome (chosen at stop) rides along so the save applies it without
      // re-prompting at the end.
      // `|| undefined`: a walk-in target (customer recorded with no booking)
      // carries id='' — coerce it so the save writes appointment_id null, not ''.
      const effectiveAppointmentId =
        (target?.appointmentId ?? recordingAppointmentId ?? nextAppointment?.id) || undefined
      const effectiveCustomerId = target?.customerId ?? (recordingAppointmentId
        ? (recordingCustomerId ?? undefined)
        : nextAppointment?.customerId)
      // Recording-session id was minted at start() (in parallel with getUserMedia)
      // — by now (recording has run its full length) it has almost always
      // resolved; this short await only covers the rare case it hasn't yet.
      // null on timeout/failure → save proceeds without recording_session_id,
      // exactly as before this feature existed (no dedupe for that save).
      const recordingSessionId = await awaitRecordingSessionId()
      // A discard during the await bumps the generation — this take no longer
      // belongs to us; drop it instead of pipelining a discarded recording.
      if (gen !== useRecordingGen.current) return
      globalPipeline.start(result.blob, {
        locale,
        customers,
        duration: Math.round(result.durationMs / 1000),
        appointmentId: effectiveAppointmentId,
        appointmentCustomerId: effectiveCustomerId,
        outcome,
        outcomeSkipped,
        recordingSessionId,
        takeId: globalRecorder.takeId,
      })
      // The pipeline now owns the audio; clear the recorder + return to idle so
      // the page isn't stuck on the "review your take" screen. keepTake: the
      // PERSISTED audio must outlive this handoff — it's deleted only when the
      // karute record saves (or is explicitly discarded), so a reload during
      // transcription can re-offer it.
      discardRecording({ keepTake: true })
      setPhase('idle')
    } finally {
      usingRecording.current = false
    }
  }
  // NOTE deliberately no handleNewSession here (3-lens fleet, packet-10): the
  // settle callbacks below used to call discardRecording() — redundant in the
  // normal case (the recorder was already cleared at pipeline hand-off) and
  // DESTRUCTIVE in record-while-processing: with a newer recording live on the
  // singleton, settling an older review killed that live capture and (post
  // take-store) deleted its persisted audio. Settling a review must never
  // touch the recorder; the phase-sync effect above owns the UI state.

  // Take recovery accept: rebuild the audio from its persisted segments and
  // hand it to the SAME background pipeline a live stop uses, with the
  // persisted context (target, recordingSessionId — so core's idempotent-save
  // dedupe still holds on the recovered save). No outcome is carried, so the
  // pipeline always lands in review — an interrupted take is processed and
  // saved manually, never auto-resumed or auto-saved.
  //
  // Re-entry guard (same class as usingRecording): loadTakeBlob opens a real
  // async window — a double-tap must not start the pipeline twice, and the
  // 破棄 button respects the ref so a Process→Discard race can't delete the
  // take out from under an accept that already committed to processing it.
  const recoveringTake = useRef(false)
  async function handleRecoverTake() {
    if (!recoveredTake || recoveringTake.current) return
    recoveringTake.current = true
    try {
      await doRecoverTake(recoveredTake)
    } finally {
      recoveringTake.current = false
    }
  }
  async function doRecoverTake(take: RecoverableTake) {
    const blob = await loadTakeBlob(take.takeId)
    if (!blob || blob.size === 0) {
      // Unreadable — corrupted, or the owner gate refused (uid changed since
      // the banner loaded, e.g. logout/login under a stale page). Do NOT
      // delete here: a delete on this path would let the wrong user destroy
      // the owner's audio. Clear the offer; the TTL owns cleanup.
      toast.error(tc('somethingWentWrong'))
      setRecoveredTake(null)
      return
    }
    globalPipeline.start(blob, {
      locale,
      customers,
      // Rough length from the flush timestamps (pauses included) — display +
      // save metadata only, nothing downstream branches on it.
      duration: Math.max(1, Math.round((take.updatedAt - take.startedAt) / 1000)),
      // '' (walk-in target) → undefined, same coercion as handleUseRecording.
      appointmentId: take.target?.appointmentId || undefined,
      appointmentCustomerId: take.target?.customerId || undefined,
      recordingSessionId: take.recordingSessionId,
      takeId: take.takeId,
    })
    setRecoveredTake(null)
  }

  // Offer the audio only while fully idle, never for the take the recorder or
  // pipeline is CURRENTLY working on (mount raced a live session), and only
  // when no review draft survived (the draft's transcription is already paid
  // for — the draft banner wins).
  const takeOffer =
    recoveredTake &&
    !recoveredDraft &&
    !restoring &&
    !live &&
    recoveredTake.takeId !== activeTakeId &&
    recoveredTake.takeId !== pipeline.context?.takeId
      ? recoveredTake
      : null

  // What the stop flow shows, decided by the pack state (single source —
  // resolveOutcomeMode): conversion dialog / repurchase dialog / nothing at all.
  const outcomeMode = resolveOutcomeMode(targetPack)

  // Slim heads-up: the picked customer is booked under another staff. The
  // record still saves under the signed-in user (currentStaffName).
  const otherStaffBanner =
    nextAppointment?.bookedUnderOtherStaff &&
    nextAppointment.staffName &&
    currentStaffName ? (
      <div className="rounded-lg bg-blue-50 px-3 py-1.5 text-[12px] leading-snug text-blue-900 dark:bg-blue-500/10 dark:text-blue-200">
        {t('otherStaffBooking', {
          staff: nextAppointment.staffName,
          you: currentStaffName,
        })}
      </div>
    ) : null

  // Mid-pack ZERO-TAP flow: the customer already paid and keeps rebooking — no
  // conversion conversation happened, so asking 成約/不成約 would pollute the
  // coaching labels. Consume 1 session (undo-able toast) + autosave without an
  // outcome row.
  function handleAutoFlow() {
    // Same re-entry guard as handleUseRecording — this path ALSO burns a
    // pack session (redeemSessionAction has no server-side idempotency), so
    // a double-tap must not fire it twice for one take.
    if (usingRecording.current) return
    if (targetPack && boundCustomerId) {
      const from = targetPack.remaining
      void redeemSessionAction({
        packId: targetPack.id,
        customerId: boundCustomerId,
        // '' for walk-in targets → null (no booking to link)
        appointmentId: boundAppointmentId ?? null,
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
          toast.error(tPacks(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'))
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
        recordingSessionId={pipeline.context.recordingSessionId}
        takeId={pipeline.context.takeId}
        onSaved={() => {
          // Save persisted the record → drop the recovery draft (storage +
          // in-memory) AND the persisted take, so no stale banner reoffers a
          // finished session.
          clearDraft()
          if (pipeline.context?.takeId) void deleteTake(pipeline.context.takeId)
          setRecoveredDraft(null)
          setRecoveredTake(null)
          globalPipeline.reset()
        }}
        onDiscard={() => {
          // Deliberate discard → drop the draft + take too, or they reappear
          // as recovery offers for a session the user intentionally threw away.
          clearDraft()
          if (pipeline.context?.takeId) void deleteTake(pipeline.context.takeId)
          setRecoveredDraft(null)
          setRecoveredTake(null)
          globalPipeline.reset()
        }}
      />
    )
  }

  // Crash recovery: the staffer chose to reopen an unsaved draft (offered by the
  // banner below). Re-mount ReviewScreen seeded from the stored draft. Entry shape
  // is mapped back from the draft's storage shape. No outcome is carried (it's
  // not persisted) — the karute saves; any pack side-effect is handled manually.
  if (restoring && recoveredDraft) {
    return (
      <ReviewScreen
        transcript={recoveredDraft.transcript}
        entries={recoveredDraft.entries.map(
          (e): Entry => ({
            category: e.category as Entry['category'],
            title: e.content,
            source_quote: e.sourceQuote ?? '',
            confidence_score: e.confidenceScore,
          }),
        )}
        summary={recoveredDraft.summary}
        customers={customers}
        duration={recoveredDraft.duration}
        appointmentId={recoveredDraft.appointmentId}
        appointmentCustomerId={recoveredDraft.appointmentCustomerId}
        recordingSessionId={recoveredDraft.recordingSessionId}
        takeId={recoveredDraft.takeId}
        onSaved={() => {
          clearDraft()
          // The draft's session is settled — its persisted audio goes too.
          if (recoveredDraft.takeId) void deleteTake(recoveredDraft.takeId)
          setRecoveredDraft(null)
          setRestoring(false)
        }}
        onDiscard={() => {
          clearDraft()
          if (recoveredDraft.takeId) void deleteTake(recoveredDraft.takeId)
          setRecoveredDraft(null)
          setRestoring(false)
        }}
      />
    )
  }

  // Map nextAppointment to the target card shape. Status key comes
  // from the server (sessions/page.tsx derives it from now vs the
  // appointment window — keeps this client component pure for
  // React Compiler). 新規 (isFirstTimeVisit) flows from the brief.
  const targetAppointment: RecordTargetAppointment | null =
    live && target
      ? // While a recording/pipeline is live, the card MUST show the customer
        // the audio is BOUND to — never re-derive from nextAppointment, which
        // can have drifted to today's first booking under the singleton.
        liveTargetCardAppointment(target, currentStaffName)
      : nextAppointment
        ? {
            id: nextAppointment.id,
            customerName: nextAppointment.customerName,
            initials: deriveInitials(nextAppointment.customerName),
            karuteNumber: nextAppointment.karuteNumber ?? null,
            service: nextAppointment.title ?? '—',
            timeRange: formatTimeRange(
              nextAppointment.startTime,
              nextAppointment.durationMinutes,
            ),
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
            // Tickets off: straight save — no burn, no 成約/回数券 dialog.
            !ticketsEnabled
              ? handleUseRecording(undefined, true)
              : outcomeMode === 'auto'
                ? handleAutoFlow()
                : setOutcomeOpen(true)
          }
        >
          {t('useRecording')}
        </Button>
      </div>
    </section>
  ) : (
    <RecordButtonCard
      customerName={boundCustomerName}
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
      {recorderControls}
      {/* Session photos — mounted only for a session BOUND to a customer.
          Deliberately target-only, never the boundCustomerId fallback: under
          an anonymous record-anyway take, nextAppointment can resolve to a
          DIFFERENT customer than the one in the chair, and photos would
          upload to them (blind-round P1 8/2, same class as the save-binding
          fix on fix/record-live-target-binding). */}
      {target?.customerId && (live || phase === 'recorded') && (
        <SessionPhotoCard
          customerId={target.customerId}
          // D2: consent FOLDS into the recording-consent line — no per-photo
          // prompt. Read fresh on every render so a mid-session grant applies
          // to photos taken after (the card freezes it per-photo at capture).
          takenWithConsent={Boolean(consentDate)}
        />
      )}
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

      {/* Background pipeline errored → localized card INSIDE the normal page
       *  frame (it used to early-return a bare card on a blank screen). The
       *  page stays usable: a new recording legitimately supersedes the
       *  errored run (single-slot pipeline; the take is preserved). */}
      {pipeline.state === 'error' && (
        <PipelineErrorCard
          code={pipeline.error}
          onCancel={() => globalPipeline.reset()}
          onRetry={() => globalPipeline.retry()}
        />
      )}

      {/* Crash-recovery offer — a session that reached the AI review but was
       *  never saved. Shown only when fully idle so it never competes with a
       *  live recording; non-hijacking (explicit 復元/破棄). */}
      {recoveredDraft && !restoring && !live && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="flex-1 text-amber-900 dark:text-amber-200">
            {t('recoverTitle')}
          </span>
          <button
            type="button"
            onClick={() => setRestoring(true)}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
          >
            {t('recoverAction')}
          </button>
          <button
            type="button"
            onClick={() => {
              clearDraft()
              // Discarding the draft settles its whole session — the linked
              // persisted audio goes too, or the take banner would re-offer
              // the session the user just threw away.
              if (recoveredDraft.takeId) void deleteTake(recoveredDraft.takeId)
              setRecoveredDraft(null)
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10"
          >
            {t('recoverDiscard')}
          </button>
        </div>
      )}

      {/* Interrupted-take offer — persisted AUDIO that never reached a saved
       *  record (killed mid-recording / reloaded mid-transcription). Shown only
       *  when no draft survived; processing it re-runs transcription. Same
       *  non-hijacking amber pattern as the draft banner above. */}
      {takeOffer && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <span className="flex-1 text-amber-900 dark:text-amber-200">
            {t('recoverTakeTitle')}
          </span>
          <button
            type="button"
            onClick={() => void handleRecoverTake()}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-700"
          >
            {t('recoverTakeAction')}
          </button>
          <button
            type="button"
            onClick={() => {
              // Inert while an accept is in flight — a Process→Discard race
              // must not delete the take mid-processing (see recoveringTake).
              if (recoveringTake.current) return
              void deleteTake(takeOffer.takeId)
              setRecoveredTake(null)
            }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10"
          >
            {t('recoverDiscard')}
          </button>
        </div>
      )}

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
              onSwitchBooking={live ? undefined : handleSwitchBooking}
            />
            {otherStaffBanner}
            <RepurchaseCueBanner pack={targetPack} />
            {visitRhythm && (
              <div className="overflow-hidden rounded-2xl border border-border">
                <VisitRhythmPanel rhythm={visitRhythm} segment={visitSegment} />
              </div>
            )}
            <ClosingTacticHint segment={visitSegment} hasTicketPack={targetHasTicketPack} />
            <Suspense
              key={nextAppointment?.customerId ?? 'none'}
              fallback={<BriefLoadingCard />}
            >
              <StreamingBriefCard
                aiBriefPromise={aiBriefPromise}
                fallbackBrief={brief}
                customerName={nextAppointment?.customerName ?? null}
              />
            </Suspense>
          </div>
          <div className="self-start">{recorderColumn}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <RecordingTargetCard
            appointment={targetAppointment}
            nearbyBookings={nearbyBookings}
            onSwitchBooking={live ? undefined : handleSwitchBooking}
          />
          {otherStaffBanner}
          <RepurchaseCueBanner pack={targetPack} />
          {visitRhythm && (
            <div className="overflow-hidden rounded-2xl border border-border">
              <VisitRhythmPanel rhythm={visitRhythm} segment={visitSegment} />
            </div>
          )}
          <ClosingTacticHint segment={visitSegment} hasTicketPack={targetHasTicketPack} />
          <Suspense
            key={nextAppointment?.customerId ?? 'none'}
            fallback={<BriefLoadingCard />}
          >
            <StreamingBriefCard
              aiBriefPromise={aiBriefPromise}
              fallbackBrief={brief}
              customerName={nextAppointment?.customerName ?? null}
            />
          </Suspense>
          <div className="mx-auto w-full max-w-md">{recorderColumn}</div>
        </div>
      )}

      <LiveTranscriptCard connected={false} lines={[]} />

      <RecentRecordingsCard recordings={recentRecordings} />

      {/* Mic source + disclosure mode: set-once config, demoted to a quiet strip
          at the very bottom so the record button stays the focus (Liam, 2026-06). */}
      <SourceModeChips />

      {/* Outcome — chosen at stop, BEFORE transcription, so staff aren't stuck
          waiting for the AI. Centered pop-up; the choice rides the pipeline
          context to the save. Never mounts with tickets off — the stop button
          saves directly and outcomeOpen can't turn true. */}
      {ticketsEnabled && (
      <PostSessionResolutionDialog
        open={outcomeOpen}
        customerName={boundCustomerName ?? ''}
        isFirstVisit={brief?.isFirstTimeVisit ?? false}
        mode={outcomeMode === 'repurchase' ? 'repurchase' : 'conversion'}
        pack={targetPack}
        packPresets={packPresets}
        staffCanCustomize={staffCanCustomizePacks}
        previousPack={previousPack}
        onCancel={() => setOutcomeOpen(false)}
        onResolve={(outcome, redeemPack, newPack: NewPackInput | null) => {
          setOutcomeOpen(false)
          // 成約/購入した with the inline picker filled → the pack is created
          // HERE, at the moment of sale (conservation law: the count-from-N
          // needs an input moment, not a profile errand).
          if (newPack && boundCustomerId) {
            const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10)
            void createPackAction({
              customerId: boundCustomerId,
              kind: 'pack',
              packSize: newPack.size,
              unitPrice: newPack.unitPrice,
              purchasedAt: jstToday,
            }).then((res) => {
              if (res.ok) {
                toast.success(
                  tPacks('packCreated', {
                    size: newPack.size,
                    price: newPack.unitPrice.toLocaleString('ja-JP'),
                  }),
                )
              } else {
                toast.error(tPacks('packCreateFailed'))
              }
            })
          }
          // Redemption records the VISIT (which already happened), so it fires
          // immediately — independent of whether the transcription/save later
          // succeeds. Failure → toast; the profile pack card is the fallback.
          if (redeemPack && targetPack && boundCustomerId) {
            void redeemSessionAction({
              packId: targetPack.id,
              customerId: boundCustomerId,
              appointmentId: boundAppointmentId ?? null,
            }).then((res) => {
              if (res.ok) toast.success(tPacks('redeemDone'))
              else toast.error(tPacks(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'))
            })
          }
          // 購入した → close the loop: the NEW pack must be registered, or the
          // alert system keeps treating them as nearly-out. One tap to the
          // profile's 登録 dialog.
          if (
            outcome.status === 'success' &&
            !newPack &&
            boundCustomerId
          ) {
            const customerId = boundCustomerId
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
      )}

      {/* Consent dialog — shared with the review screen's save-time gate */}
      {showConsentDialog && nextAppointment && (
        <RecordingConsentDialog
          customerName={nextAppointment.customerName}
          submitting={consentSubmitting}
          error={consentError}
          onCancel={() => setShowConsentDialog(false)}
          onConfirm={handleGrantConsent}
        />
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

      {/* D3 — discard-with-photos confirmation. Only reachable from
          handleDiscard (the explicit 破棄 button); the save path
          (handleUseRecording) never shows this. */}
      {showDiscardPhotosDialog && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !discardingPhotos && setShowDiscardPhotosDialog(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('sessionPhotos.discardPhotosTitle')}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <h3 className="text-base font-semibold text-foreground">
              {t('sessionPhotos.discardPhotosTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('sessionPhotos.discardPhotosDescription')}
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={handleDiscardKeepPhotos}
                disabled={discardingPhotos}
              >
                {t('sessionPhotos.discardPhotosKeep')}
              </Button>
              <Button
                variant="default"
                size="md"
                className="flex-1"
                onClick={handleDiscardDeletePhotos}
                disabled={discardingPhotos}
              >
                {t('sessionPhotos.discardPhotosDelete')}
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

// Leaf that unwraps the streamed AI brief. use() suspends ONLY this child, so
// the Suspense fallback (the mechanical card) shows while gpt-4o writes; when it
// resolves the card swaps in the AI brief. It must stay a separate leaf — using
// use() in RecordPageView's body would suspend the whole screen and unmount the
// recorder/mic/elapsed timer mid-session. isFirstTimeVisit is pinned to the
// mechanical value so the card's 新規-vs-returning framing can't flip a beat
// after paint (the same signal the target badge + post-session dialog use).
// Shimmer shown while the AI brief resolves. The old fallback rendered the
// MECHANICAL brief here, so staff read one brief for a beat and then watched
// it morph into the AI version (Liam, 2026-07-09) — content must paint ONCE.
// The mechanical brief still renders, but only as StreamingBriefCard's
// fallback when the AI call actually fails.
function BriefLoadingCard() {
  return (
    <section
      aria-busy
      className="animate-pulse rounded-2xl border border-blue-200/50 bg-blue-50/30 p-5 dark:border-blue-500/20 dark:bg-blue-500/[0.05]"
    >
      <div className="mb-4 flex items-center gap-2.5">
        <div className="size-8 rounded-full bg-blue-200/60 dark:bg-blue-500/20" />
        <div className="h-3.5 w-40 rounded bg-blue-200/60 dark:bg-blue-500/20" />
      </div>
      <div className="space-y-2.5">
        <div className="h-14 rounded-xl bg-black/[0.04] dark:bg-white/[0.05]" />
        <div className="h-14 rounded-xl bg-black/[0.04] dark:bg-white/[0.05]" />
        <div className="h-9 w-2/3 rounded-xl bg-black/[0.04] dark:bg-white/[0.05]" />
      </div>
    </section>
  )
}

function StreamingBriefCard({
  aiBriefPromise,
  fallbackBrief,
  customerName,
}: {
  aiBriefPromise: Promise<PreSessionBriefResult | null>
  fallbackBrief: PreSessionBrief | null
  customerName: string | null
}) {
  const ai = use(aiBriefPromise)
  const merged: PreSessionBrief | null = ai
    ? { ...ai, isFirstTimeVisit: fallbackBrief?.isFirstTimeVisit ?? ai.isFirstTimeVisit }
    : fallbackBrief
  return <PreSessionBriefCard brief={merged} customerName={customerName} />
}
