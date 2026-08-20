'use client'

import { Suspense, use, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button, ConsentCheckCard } from '@synqed-kk/ui'
import { toast } from 'sonner'

import { useRouter } from '@/i18n/navigation'
import { useGlobalRecorder } from '@/hooks/use-global-recorder'
import { useWaveformBars } from '@/hooks/use-waveform-bars'
import { ReviewScreen } from '@/components/review/ReviewScreen'
import { loadDraft, clearDraft, type KaruteDraft } from '@/lib/karute/draft'
import {
  deleteTake,
  getRecoverableTake,
  loadTakeBlob,
  stampTakeOutcome,
  type RecoverableTake,
} from '@/lib/karute/take-store'
import { globalRecorder } from '@/lib/global-recorder'
import { globalPipeline } from '@/lib/global-pipeline'
import { useGlobalPipeline } from '@/hooks/use-global-pipeline'
import { useTimetableStore } from '@/stores/timetable-store'
import { type CustomerOption } from '@/components/karute/CustomerCombobox'
import {
  getCustomerConsent,
  grantCustomerConsent,
  deleteCustomerPhoto,
} from '@/actions/customers'
import { isConsentCurrent } from '@/lib/consent'
import { sessionPhotoStore } from '@/lib/karute/session-photos'
import { saveKaruteRecordInline } from '@/actions/karute'
import { getRecoveryDayFacts } from '@/actions/recovery'
import type { RecoveryDayFacts } from '@/lib/karute/recovery-facts'
import { formatCompactDateJst, hmInJst, ymdInJst } from '@/lib/date/jst'
import type { EntryCategory } from '@/lib/karute/categories'

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
  RecordCustomerPickerDialog,
  type RecordCustomerFact,
} from './RecordCustomerPickerDialog'
import { RecoveryBanner, type RecoveryTicketState } from './RecoveryBanner'
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
  /** records.delete (owner/manager/senior) — without it the D3 discard dialog
   *  drops the 写真も削除 affordance and offers keep-only. Server-enforced
   *  either way (deleteCustomerPhoto / the facade DELETE both gate on it). */
  staffCanDeletePhotos?: boolean
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
  /** Per-customer display facts for the お客様を選んで録音 dialog (karute #,
   *  新規, 残n/m, 前回, 担当). Absent → the dialog renders its lean rows. */
  customerFacts?: RecordCustomerFact[]
}

/**
 * What the save binds the take to. Exported for tests.
 *
 * The take may bind ONLY to what it was actually recorded against — the
 * bound `target`, or the timetable-store ids for the 予約-launched flow.
 * NEVER to `nextAppointment`: the schedule can drift to a different customer
 * between start and save (blind-round P1 8/2 — an anonymous record-anyway
 * take silently attached to the next booking, and a bound walk-in captured
 * the schedule's appointment id). An anonymous take returns nothing here —
 * per handleStartAnyway's contract, the save then requires picking a
 * customer downstream, exactly like the no-schedule case always has.
 */
export function resolveSaveBinding(
  target: { customerId: string; appointmentId: string | null } | null,
  recordingAppointmentId: string | null,
  recordingCustomerId: string | null,
): { appointmentId: string | undefined; customerId: string | undefined } {
  return {
    appointmentId: (target?.appointmentId ?? recordingAppointmentId) || undefined,
    customerId:
      target?.customerId ??
      (recordingAppointmentId ? (recordingCustomerId ?? undefined) : undefined),
  }
}

/**
 * The 既存のお客様 gate signal, read off the server-built brief. Exported for tests.
 *
 * `brief.isFirstTimeVisit` is buildRecordScreen's own isReturningCustomer()
 * verdict over the FULL signal set (QuickReserve flag, visit count, karute
 * count, 回数券) — for the booked target AND the no-appointment walk-in, both
 * of which populate nextAppointment. This must NOT reuse the `?? false` the
 * `isFirstVisit` prop applies: a null brief (no resolved target) or a cached/
 * facade brief predating the optional field means UNKNOWN, and an unknown
 * customer must never be offered 「通常ご来店」 speculatively (plan L2#4).
 */
export function resolveReturningForOutcome(
  brief: { isFirstTimeVisit?: boolean } | null | undefined,
): boolean | null {
  return brief?.isFirstTimeVisit == null ? null : !brief.isFirstTimeVisit
}

/**
 * Which stop flow the 録音を使用 tap runs. Exported for tests.
 *
 * Ticket economics (auto-burn / 成約・回数券 dialog) may fire ONLY when the
 * schedule data they price against belongs to the session's own customer:
 * under a schedule mismatch (incl. an anonymous take) the pack/outcome data
 * on screen is another customer's — burning or creating against it is the
 * money-side of the same misattribution bug (delta-verify catch 8/2). Those
 * sessions save directly; 成約/回数券 completes later via the profile flows.
 */
export function resolveStopFlow(opts: {
  ticketsEnabled: boolean
  canRunOutcome: boolean
  outcomeMode: 'auto' | 'conversion' | 'repurchase'
}): 'save-direct' | 'auto-redeem' | 'dialog' {
  if (!opts.ticketsEnabled || !opts.canRunOutcome) return 'save-direct'
  return opts.outcomeMode === 'auto' ? 'auto-redeem' : 'dialog'
}

/** The ONE unsaved session the banner offers. A surviving review draft still
 *  wins over raw audio — its transcription is already paid for. */
type RecoveryOffer =
  | { kind: 'draft'; draft: KaruteDraft }
  | { kind: 'take'; take: RecoverableTake }

/** Where a recovery save lands. Either what the audio was BOUND to at record
 *  time or the staff's explicit re-point — never today's schedule. */
interface RecoveryDestination {
  customerId: string
  customerName: string
  karuteNumber?: string | null
  appointmentId: string | null
}

/** Stable identity for one unsaved session — the key A-4's answer latch and
 *  A-1's abort effect both hang off. A draft has no id of its own; its save
 *  timestamp is unique per draft and survives a reload, which is all this
 *  needs. */
function recoveryOfferId(o: RecoveryOffer): string {
  return o.kind === 'take' ? `take:${o.take.takeId}` : `draft:${o.draft.savedAt}`
}

/** An answer whose MONEY PHASE completed. Recorded per offer so a retry after
 *  a failed karute save never re-runs the legs (A-4). */
interface RecoveryAnswer {
  outcome: SessionOutcome | undefined
  skipped: boolean
}

/**
 * A recovery save in flight, FROZEN at the tap (A-1).
 *
 * Every step downstream — consent, the outcome popup, the money legs, the
 * write — takes this as an argument instead of re-reading `offer`/
 * `destination`/`ticket` from render scope. Those are derived from live state
 * that a NEW recording wipes out: mid-flow they would evaporate, unmounting
 * the dialogs, wedging the latch, and (worst case) failing the write's own
 * `!offer` bail AFTER the money already moved — a silently lost karute under
 * a success toast.
 */
interface RecoveryFlow {
  offerId: string
  offer: RecoveryOffer
  dest: RecoveryDestination
  /** JST day of the recording — dates the burn and the pack purchase. */
  dayYmd: string
  durationSec: number
  /** The FIFO burn target for `dest`, resolved at freeze time. */
  packId: string | null
  pack: { remaining: number; size: number } | null
  /** This visit's ticket already moved — the popup states it instead of
   *  offering a second one. */
  alreadyRedeemed: boolean
}

/** A-5 — the day's facts are three worlds, not two. `failed` is what the
 *  server's explicit `unavailable` flag maps to; it is NOT an empty day. */
type DayFactsState =
  | { status: 'loading' }
  | { status: 'loaded'; facts: RecoveryDayFacts }
  | { status: 'failed' }

/** What the recovery banner's 回数券 line says. Exported for tests.
 *
 * DERIVED truth only (R-B2 / F7): packs minus redemptions, both read from the
 * server for the RECORDING's day. Three honest states and no fourth —
 * `facts.redeemed === null` means the burn history could not be read, and an
 * unknown ticket state must render NOTHING rather than a calm-looking 未処理
 * that could be a lie about money.
 *
 * `redeemed` for the UNBOOKED case keys on the customer + the recording's JST
 * day (buildRecoveryDayFacts filters it), which is the same dedupe key D5's
 * guard writes against — so the banner and the guard can never disagree.
 */
export function resolveRecoveryTicketState(opts: {
  facts: RecoveryDayFacts | null
  customerId: string | null
  appointmentId: string | null
}): {
  state: RecoveryTicketState
  pack: { remaining: number; size: number } | null
  /** The FIFO burn target for this customer — null when there is nothing
   *  burnable, which is also the only state in which the popup must not offer
   *  a burn at all. */
  packId: string | null
} {
  const { facts, customerId, appointmentId } = opts
  if (!facts || !customerId) return { state: 'none', pack: null, packId: null }
  const row = facts.packs.find((p) => p.customerId === customerId) ?? null
  const pack = row ? { remaining: row.remaining, size: row.size } : null
  const packId = row?.packId ?? null
  if (!facts.redeemed) return { state: 'none', pack, packId }
  // A-2: EITHER key means this visit's ticket already moved. Keying a booked
  // destination on the appointment alone missed a prior NULL-appointment burn
  // for the same customer-day (a reconcile-strip backfill, an earlier walk-in
  // recovery) — the banner then read 未処理 and the popup offered a burn the
  // customer had already paid. Same OR the server-side guard now applies.
  const burned =
    (!!appointmentId && facts.redeemed.appointmentIds.includes(appointmentId)) ||
    facts.redeemed.customerIds.includes(customerId)
  if (burned) return { state: 'redeemed', pack, packId }
  return { state: pack ? 'unresolved' : 'none', pack, packId }
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
  staffCanDeletePhotos = true,
  previousPack = null,
  noiseSuppression = true,
  currentStaffName = null,
  ticketsEnabled = true,
  customerFacts,
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
  const boundCustomerName = (live && target ? target.customerName : nextAppointment?.customerName) ?? null
  // Belt & suspenders (field bug 8/2): any entry path that leaves the recorder
  // in flight for one customer while `nextAppointment` resolved to another
  // (deep link, back-nav, stale tab) must never paint that OTHER customer's
  // schedule-derived sections under the session. Covers BOTH a bound target of
  // a different customer AND an anonymous record-anyway take (target null —
  // blind-round P1: the page must not masquerade the schedule's customer as
  // the one being recorded). Keyed on recState, not `live`: pipeline-active
  // with an idle recorder is the normal post-handoff state and stays unguarded.
  const scheduleMismatch = Boolean(
    recState !== 'idle' &&
      nextAppointment &&
      (!target || target.customerId !== nextAppointment.customerId),
  )
  // Single source of binding for EVERYTHING the stop flow writes — the karute
  // save AND the pack money mutations (delta-verify catch 8/2: the latter
  // still rode boundCustomerId's nextAppointment fall-through).
  const saveBinding = resolveSaveBinding(
    target,
    recordingAppointmentId ?? null,
    recordingCustomerId ?? null,
  )
  const canRunOutcome = !scheduleMismatch && Boolean(saveBinding.customerId)

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
  const [showCustomerPicker, setShowCustomerPicker] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)

  // Idle, no take in flight, and NO booking of the signed-in staff's own today
  // — buildRecordScreen no longer auto-picks a colleague's booking (8/19
  // ruling), so there is nothing to record against until the staff says who.
  // The target card carries the two explicit actions and the big record button
  // steps aside (mock A2); the walk-in flow itself is unchanged, only its
  // trigger moved out of the no-booking prompt.
  // recState, NOT the composite `live` (A-1, 8/19): a pipeline still crunching
  // the LAST take with an idle recorder is a normal working window — the staff
  // can and must line up the next customer there. Gating on `live` dropped them
  // back onto the legacy scaffold, whose 別の予約を選択 sheet lists the whole salon.
  const showNoTargetActions = phase === 'idle' && recState === 'idle' && !nextAppointment

  // B-8: the picker exists ONLY in that state. QuietRefresh re-renders this
  // page with fresh server props behind the paint, so a target can bind while
  // the dialog is open (a colleague hands over a booking, the staffer's own is
  // created) — and showCustomerPicker, a plain flag, never noticed: the dialog
  // floated over a bound screen and its rows navigated away from a live target.
  // The flag follows the state back down, so the dialog also can't spring open
  // by itself the next time the target clears. The render gate below is the
  // enforcement; this keeps the flag from lying in between.
  useEffect(() => {
    if (!showNoTargetActions) setShowCustomerPicker(false)
  }, [showNoTargetActions])
  // Outcome is chosen the MOMENT recording stops (the staff knows it live),
  // before transcription — so they decide once, up front, then the AI runs in
  // the background while they move on. It rides the pipeline context to save.
  const [outcomeOpen, setOutcomeOpen] = useState(false)

  // C-1: the 録音を使用 tap is the ONE user-reachable caller of
  // globalPipeline.start on this screen (take-recovery's banner is gated on
  // !live), and the pipeline is single-slot — a start() while a previous run
  // is still processing supersedes it. On the in-tab arm that DROPS the old
  // run's result un-settled, which used to happen without a word.
  const [showSupersedeDialog, setShowSupersedeDialog] = useState(false)
  // Same convention B-8 established for the picker: the confirm may exist ONLY
  // while there is a run to supersede. The render gate below is the
  // enforcement; this keeps the flag from lying in between — a stale true
  // would spring the dialog open, uninvited and now untrue, the moment the
  // NEXT take's pipeline starts processing.
  //
  // 'autosaving' counts as a run to supersede (fix round 6), for the same
  // reason the tap gate and the render gate span it: until the autosave
  // dispatches there is still an unsaved result to ask about. Narrower, this
  // effect SWALLOWS the tap it exists to protect — in the race window it is a
  // pending passive effect of the very commit that turned 'autosaving', so the
  // tap's setShowSupersedeDialog(true) is followed in the same hook queue by
  // this effect's false, and the confirm never paints. review/idle/error still
  // clear it: there the question is moot.
  useEffect(() => {
    if (pipeline.state !== 'processing' && pipeline.state !== 'autosaving')
      setShowSupersedeDialog(false)
  }, [pipeline.state])

  // D3: discard-with-photos confirmation (see handleDiscard below).
  const [showDiscardPhotosDialog, setShowDiscardPhotosDialog] = useState(false)
  const [discardingPhotos, setDiscardingPhotos] = useState(false)

  // Single-flight guard for the outcome dialog's 保存: a double-tap must never
  // create two pack rows or fire two redemptions (live prod bug — the DB's
  // partial unique index on pack_redemptions(appointment_id) can't block the
  // walk-in NULL case, and pack creation has no dedupe of its own). The REF is
  // the real guard — the synchronous re-entry check (state reads stale
  // mid-tick, same reason usingRecording below is a ref). The state feeds the
  // dialog's `saving` prop as belt-and-braces for a future edit that changes
  // the close timing — TODAY it is NOT visibly observable at this call site:
  // onResolve closes the dialog (setOutcomeOpen(false)) in the same batch it
  // sets both, so the dialog never actually renders with saving=true here.
  // Reset on the dialog's OPEN transition too (openOutcomeDialog below), not
  // just in onResolve's finally — a hung take's write must not pre-lock the
  // NEXT take's dialog as 保存中 (F2, PR-0 fix round).
  const resolvingOutcomeRef = useRef(false)
  const [resolvingOutcome, setResolvingOutcome] = useState(false)

  // Per-take resolution latch (Greptile P1, #679): resolvingOutcomeRef only
  // guards ONE in-flight resolve — it's intentionally reset on the dialog's
  // OPEN transition (openOutcomeDialog, F2 above) so a hung write can't wedge
  // the NEXT take's dialog shut. But that open-reset also let a re-tap of
  // 録音を使用 for the SAME take reopen the dialog while onResolve's write is
  // still in flight (handleUseRecording awaits a session-id mint before
  // flipping `phase` back to idle, so the button stays tappable) — a second
  // 保存 there re-fires createPackAction/redeemSessionAction with identical
  // inputs. This ref latches ONCE the take has been resolved and blocks
  // openOutcomeDialog from reopening for it; cleared only at the same
  // take-lifecycle boundaries useRecordingGen already bumps at (a new take
  // starting or the current one being discarded). Invariant: ONE resolution
  // per take.
  //
  // Accepted residual (fresh-eyes round, PR-0 round 2): this is a component
  // ref, not persisted state — a full page unmount+remount inside the
  // ≤1500ms session-mint window (awaitRecordingSessionId's default timeout,
  // global-recorder.ts) re-arms a fresh ref for an already-resolved take.
  // Judged unreachable in practice: a real navigation round-trip doesn't
  // complete inside that window. resolvingOutcomeRef has the same pre-
  // existing exposure. Upgrade path if it ever matters: carry a
  // resolvedTakeId on the globalRecorder singleton (survives remount)
  // instead of a boolean ref on the component.
  const outcomeResolvedRef = useRef(false)

  // Re-entry + staleness guards for the use-recording flow (it awaits the
  // session-id mint, so it's no longer atomic): first tap wins, and a discard
  // bumps the generation so an in-flight use drops its now-discarded take.
  const usingRecording = useRef(false)
  const useRecordingGen = useRef(0)

  // Crash recovery: a draft persisted by ReviewScreen from a session that was
  // never saved (WebView killed, tab reloaded). Loaded after mount (client-only,
  // so no SSR hydration mismatch).
  const [recoveredDraft, setRecoveredDraft] = useState<KaruteDraft | null>(null)
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
    // A new take begins here — clear the previous take's resolution latch.
    outcomeResolvedRef.current = false
    // A hung write must not dead-lock the NEXT take's save button: the finally
    // below may never run (unsettled promise), and the belt keys off this state.
    // Same boundary F2 already resets the latch at. A stale finally later
    // clearing a newer take's belt is cosmetic — the ref latch in
    // openOutcomeDialog stays the real guard.
    resolvingOutcomeRef.current = false
    setResolvingOutcome(false)
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
    // A new take begins here — clear the previous take's resolution latch.
    outcomeResolvedRef.current = false
    // belt reset — see handleStartRecording
    resolvingOutcomeRef.current = false
    setResolvingOutcome(false)
    // Two entry points: the no-booking prompt's recordAnyway button, and the
    // no-own-booking card's 選択せずに録音する action (RecordingTargetCard's
    // onRecordWithoutCustomer). Both mean nextAppointment is null, so there
    // is no customer to bind (walk-in); the save will require picking one.
    startRecording({ noiseSuppression, target: null })
  }
  // D3 (Liam canon): discarding a recording that has session photos ASKS
  // EACH TIME — never silently drops or silently keeps them. Fires for ANY
  // 'uploading' OR 'done' photo (§7 fix round: an in-flight upload is just
  // as real as a landed one — silently losing track of it would be the same
  // class of bug the dialog exists to prevent). target?.customerId (not
  // boundCustomerId) matches SessionPhotoCard's own mount/render filter
  // exactly, so this can never act on a stale/different customer's photos.
  function sessionPhotosForDiscardDialog() {
    const cid = target?.customerId
    if (!cid) return []
    return sessionPhotoStore.photos.filter(
      (p) => p.customerId === cid && (p.status === 'uploading' || p.status === 'done'),
    )
  }

  // §9: the honest-loss toast for photos that failed to upload — computed
  // and fired HERE (before discardRecording()/the save handoff triggers the
  // store's clear(), which wipes `photos`), never inside the store itself
  // (i18n needs React's t()).
  function toastDroppedErrorPhotos() {
    const cid = target?.customerId
    if (!cid) return
    const dropped = sessionPhotoStore.photos.filter(
      (p) => p.customerId === cid && p.status === 'error',
    ).length
    if (dropped > 0) toast.warning(t('sessionPhotos.uploadsDropped', { n: dropped }))
  }

  function proceedDiscard() {
    toastDroppedErrorPhotos()
    // Invalidate any in-flight handleUseRecording: its post-await body must
    // not hand a take the staff just discarded to the pipeline.
    useRecordingGen.current++
    // The discarded take is done — its resolution latch (if any) must not
    // carry over and wedge the NEXT take's dialog shut.
    outcomeResolvedRef.current = false
    // belt reset — see handleStartRecording
    resolvingOutcomeRef.current = false
    setResolvingOutcome(false)
    discardRecording()
    setPhase('idle')
  }

  function handleDiscard() {
    if (sessionPhotosForDiscardDialog().length > 0) {
      setShowDiscardPhotosDialog(true)
      return
    }
    proceedDiscard()
  }

  function handleDiscardCancel() {
    // Full abort — the recording stays exactly as it was, nothing proceeds.
    setShowDiscardPhotosDialog(false)
  }

  async function handleDiscardDeletePhotos() {
    const photos = sessionPhotosForDiscardDialog()
    const donePhotos = photos.filter((p) => p.status === 'done')
    // §7: an 'uploading' photo hasn't landed server-side yet — mark it for
    // delete-after-settle (the store fires the delete itself the moment
    // that upload resolves to 'done'; nothing to do on 'error'). Marked
    // BEFORE proceedDiscard, whose discardRecording() wipes the strip.
    // The onFail closure carries t() so a settle-path delete failure gets the
    // SAME toast as its done-photos twin below (n:1 — one photo per mark).
    // Firing after navigation is fine: sonner's toaster is app-global.
    for (const p of photos) {
      if (p.status === 'uploading') {
        sessionPhotoStore.markDeleteAfterSettle(p.id, p.customerId, () =>
          toast.error(t('sessionPhotos.discardDeleteFailed', { n: 1 })),
        )
      }
    }
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
      const { appointmentId: effectiveAppointmentId, customerId: effectiveCustomerId } =
        saveBinding
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
      // §9: same honest-loss toast as the discard path — computed/fired
      // BEFORE discardRecording() below wipes the strip via the store's
      // clear(). The save handoff never shows the D3 dialog (structurally
      // separate from handleDiscard — this function never references
      // showDiscardPhotosDialog/sessionPhotosForDiscardDialog); a photo
      // that failed to upload is still lost here exactly as on discard.
      toastDroppedErrorPhotos()
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

  // NOTE (PR-B1): the old take-recovery accept (handleRecoverTake /
  // doRecoverTake) is gone. It started the pipeline with NO outcome, so a
  // recovered take could never join the autosave cohort and always took a
  // review detour. commitRecoverySave below is its replacement — same
  // pipeline, same persisted context, plus the restored outcome (D6).

  // Offer the audio only while fully idle, never for the take the recorder or
  // pipeline is CURRENTLY working on (mount raced a live session), and only
  // when no review draft survived (the draft's transcription is already paid
  // for — the draft banner wins).
  const takeOffer =
    recoveredTake &&
    !recoveredDraft &&
    !live &&
    recoveredTake.takeId !== activeTakeId &&
    recoveredTake.takeId !== pipeline.context?.takeId
      ? recoveredTake
      : null

  // ── PR-B1: ONE recovery offer, ONE banner, ONE action ────────────────────
  // The draft still wins over the take (its transcription is already paid
  // for); what changed is that both now render the SAME informative card and
  // save through the SAME flow instead of two strips with a 破棄 button.
  const draftOffer = recoveredDraft && !live ? recoveredDraft : null
  const offer: RecoveryOffer | null = draftOffer
    ? { kind: 'draft', draft: draftOffer }
    : takeOffer
      ? { kind: 'take', take: takeOffer }
      : null

  // When the audio was captured. The take stamps its real start; a draft only
  // knows when the AI result landed, so its start is that minus the recorded
  // length — approximate by the transcription time, and used only for display
  // + the picker's day.
  const offerStartedAt = offer
    ? offer.kind === 'take'
      ? offer.take.startedAt
      : offer.draft.savedAt - (offer.draft.duration ?? 0) * 1000
    : null
  const offerDurationSec = offer
    ? offer.kind === 'take'
      ? Math.max(1, Math.round((offer.take.updatedAt - offer.take.startedAt) / 1000))
      : (offer.draft.duration ?? 0)
    : 0
  const offerDayYmd = offerStartedAt ? ymdInJst(new Date(offerStartedAt)) : null

  // Where the save lands: the staff's re-point if they made one, else what the
  // audio was bound to at record time. NEVER nextAppointment — the schedule
  // has moved on since the crash (the 8/2 misattribution class).
  const [repointed, setRepointed] = useState<RecoveryDestination | null>(null)
  const offerBinding: RecoveryDestination | null = offer
    ? offer.kind === 'take'
      ? offer.take.target
        ? {
            customerId: offer.take.target.customerId,
            customerName: offer.take.target.customerName,
            // B-4: the take's bind-time snapshot already carries it.
            karuteNumber: offer.take.target.karuteNumber,
            appointmentId: offer.take.target.appointmentId || null,
          }
        : null
      : offer.draft.appointmentCustomerId
        ? {
            customerId: offer.draft.appointmentCustomerId,
            // B-1: a draft whose customer has since left the cached list still
            // has a real, saveable id — only the NAME is unknown. Coalesce it
            // so the banner can never read as unbound (which would send the
            // staffer to a picker they don't need, and open a blank-titled
            // popup). Bound-ness is decided by the destination, never by
            // whether a display string happened to resolve.
            customerName:
              customers.find((c) => c.id === offer.draft.appointmentCustomerId)?.name ||
              t('recoverCustomerUnknown'),
            appointmentId: offer.draft.appointmentId || null,
          }
        : null
    : null
  const destination = repointed ?? offerBinding

  // ── Recording-day facts: TRI-STATE (A-5) ─────────────────────────────────
  // `null` used to conflate three different worlds — still loading, no pack,
  // and the read FAILED — and the save button never knew the difference, so a
  // tap landing before the fetch resolved silently skipped the burn question.
  // The server now answers with an explicit `unavailable` discriminant.
  const [dayFacts, setDayFacts] = useState<DayFactsState>({ status: 'loading' })
  // Bumped by the banner's retry affordance — the only way `failed` clears.
  const [factsAttempt, setFactsAttempt] = useState(0)
  // Keyed on the DESTINATION too (A-4): after a re-point the burn history for
  // the NEW customer is what decides 消化済み, so stale facts must not survive.
  const factsKey = offer
    ? `${offerDayYmd}|${offerBinding?.customerId ?? ''}|${destination?.customerId ?? ''}|${factsAttempt}`
    : null
  useEffect(() => {
    if (!factsKey || !offerDayYmd) return
    let cancelled = false
    setDayFacts({ status: 'loading' })
    void getRecoveryDayFacts({
      date: offerDayYmd,
      // The ORIGINAL binding stays the pin, so the picker can always offer the
      // take's own customer back — even after a re-point away from them.
      pinnedCustomerId: offerBinding?.customerId ?? null,
    }).then((f) => {
      if (cancelled) return
      setDayFacts(f.unavailable ? { status: 'failed' } : { status: 'loaded', facts: f })
    })
    return () => {
      cancelled = true
    }
    // factsKey collapses every input — re-fetch only when one genuinely moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey])

  const loadedFacts = dayFacts.status === 'loaded' ? dayFacts.facts : null
  const ticket = resolveRecoveryTicketState({
    facts: loadedFacts,
    customerId: destination?.customerId ?? null,
    appointmentId: destination?.appointmentId ?? null,
  })
  // A-5: money questions need the day's truth. Tickets off → there is no money
  // question at all, so a failed read must NOT strand the record (it only
  // costs the picker its detail lines).
  const factsBlockSave = ticketsEnabled && dayFacts.status !== 'loaded'

  const [repointOpen, setRepointOpen] = useState(false)
  const [recoverySaving, setRecoverySaving] = useState(false)
  // An unbound take's picked destination, waiting for its day facts (see
  // repointTo). Never set for a plain re-point of a bound take — that one just
  // updates the banner and waits for the staffer's 保存する.
  const [pendingStart, setPendingStart] = useState<RecoveryDestination | null>(null)
  // A-1 ②: both dialogs render off the FROZEN flow, not off live state — a new
  // recording starting mid-flow used to evaporate `offer`/`destination` under
  // them, unmounting the dialog and wedging the latch.
  const [outcomeFlow, setOutcomeFlow] = useState<RecoveryFlow | null>(null)
  const [consentFlow, setConsentFlow] = useState<RecoveryFlow | null>(null)
  // Synchronous single-flight for the whole recovery save (state reads stale
  // mid-tick — same reason resolvingOutcomeRef is a ref).
  const recoverySavingRef = useRef(false)
  // A SECOND, narrower latch for the popup's own 保存: the outer one spans the
  // whole flow (it is what greys the banner), so feeding it to the dialog's
  // `saving` prop would leave the dialog's own button disabled from the moment
  // it opens — the staffer could never answer. This one spans only the money
  // legs, exactly like resolvingOutcome does on the normal path.
  const recoveryResolvingRef = useRef(false)
  const [recoveryResolving, setRecoveryResolving] = useState(false)
  // Which offer the in-flight flow belongs to, and whether its write has begun
  // — the abort effect's two inputs.
  const flowRef = useRef<{ offerId: string; committing: boolean } | null>(null)
  // A-4 — the per-offer answer latch. Money legs are NOT idempotent as a set:
  // a burn is guarded server-side, but createPackAction has no dedupe of its
  // own, so a retry after "burn landed, karute save failed" would MINT A SECOND
  // 回数券 SALE. Once an offer's answer has been through its money phase it is
  // recorded here, and every retry goes straight to the save with it.
  const answeredRef = useRef(new Map<string, RecoveryAnswer>())

  function releaseRecoverySave() {
    recoverySavingRef.current = false
    recoveryResolvingRef.current = false
    flowRef.current = null
    setRecoverySaving(false)
    setRecoveryResolving(false)
  }

  // A-1 ③ — the abort. If the offer a flow was saving disappears before its
  // write began (the staffer starts a NEW recording, another tab settles the
  // session), tear the flow down: leaving it up means dialogs bound to a dead
  // offer and a latch nothing will ever release. Deliberately skipped once the
  // commit is under way — that path clears the offer itself, on purpose.
  const activeOfferId = offer ? recoveryOfferId(offer) : null
  useEffect(() => {
    const f = flowRef.current
    if (!f || f.committing || f.offerId === activeOfferId) return
    setConsentFlow(null)
    setOutcomeFlow(null)
    setRepointOpen(false)
    setRepointed(null)
    releaseRecoverySave()
  }, [activeOfferId])

  /** 保存する. Unbound take → the picker decides the destination first. */
  function handleRecoverySaveTap() {
    if (recoverySavingRef.current) return
    if (!destination) {
      setRepointOpen(true)
      return
    }
    startRecoveryFlow(destination)
  }

  /** A-1 ① — FREEZE, then run. Everything downstream takes this object as an
   *  argument; nothing re-reads `offer`/`destination`/`ticket` from render
   *  scope, so the flow survives whatever the page does underneath it. */
  function startRecoveryFlow(dest: RecoveryDestination) {
    if (recoverySavingRef.current || !offer || !offerDayYmd || factsBlockSave) return
    // Recomputed for THIS destination rather than reusing the render's
    // `ticket`: a pick made in the picker lands here before React has
    // re-rendered with the new destination, and a stale null pack would hide a
    // burn the customer actually has.
    const own = resolveRecoveryTicketState({
      facts: loadedFacts,
      customerId: dest.customerId,
      appointmentId: dest.appointmentId,
    })
    const flow: RecoveryFlow = {
      offerId: recoveryOfferId(offer),
      offer,
      dest,
      dayYmd: offerDayYmd,
      durationSec: offerDurationSec,
      packId: own.packId,
      pack: own.pack,
      alreadyRedeemed: own.state === 'redeemed',
    }
    recoverySavingRef.current = true
    flowRef.current = { offerId: flow.offerId, committing: false }
    setRecoverySaving(true)
    void beginRecoverySave(flow)
  }

  /** The picker's exit. For a take that HAD a destination this is a plain
   *  re-point (the staffer taps 保存する when they're ready); for an unbound
   *  one the picker WAS the save's first step — its button says
   *  お客様を選んで保存する — so the save continues from here. */
  function repointTo(dest: RecoveryDestination | null) {
    // B-6: judge BEFORE mutating, or the setState below changes the very
    // condition the continuation is decided by.
    const continueSave = !destination && !!dest && !recoverySavingRef.current
    setRepointOpen(false)
    setRepointed(dest)
    // NOT started here: a new destination re-fetches the day's facts, and the
    // flow must freeze the ticket for the customer it is ACTUALLY saving to.
    // Starting synchronously would freeze the OLD facts — for an unbound take
    // that means a null pack, so a customer with a live 回数券 would be saved
    // with the burn question silently skipped. The effect below starts it the
    // moment the right facts are in.
    if (continueSave && dest) setPendingStart(dest)
  }

  /** The deferred half of repointTo: fires once the destination's own day facts
   *  have landed, so startRecoveryFlow freezes a ticket that is actually true. */
  useEffect(() => {
    if (!pendingStart || factsBlockSave || recoverySavingRef.current) return
    const dest = pendingStart
    setPendingStart(null)
    startRecoveryFlow(dest)
    // startRecoveryFlow closes over this render's facts, which is exactly what
    // the gate above just proved fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStart, factsBlockSave])

  /** Consent gate, then the outcome question, then the save. Fail CLOSED: an
   *  unreadable consent opens the grant dialog and the save stays locked —
   *  identical rule to ReviewScreen's save-time gate (the server enforces it
   *  again either way). */
  async function beginRecoverySave(flow: RecoveryFlow) {
    let consentCurrent = false
    try {
      const { consent: row } = await getCustomerConsent(flow.dest.customerId)
      consentCurrent = isConsentCurrent(row)
    } catch {
      consentCurrent = false
    }
    if (!consentCurrent) {
      setConsentError(null)
      setConsentFlow(flow)
      return
    }
    await afterRecoveryConsent(flow)
  }

  async function afterRecoveryConsent(flow: RecoveryFlow) {
    // A-4 — this offer's money phase already completed once (a retry after a
    // failed save). Never re-open the popup, never re-run the legs.
    const answered = answeredRef.current.get(flow.offerId)
    if (answered) {
      await commitRecoverySave(flow, answered.outcome, answered.skipped)
      return
    }
    // The answer SURVIVED the crash (D6) — its money legs settled server-side
    // before the crash, so re-asking would offer a second burn for one visit.
    const persisted = flow.offer.kind === 'take' ? flow.offer.take.outcome : undefined
    const persistedSkipped =
      flow.offer.kind === 'take' ? flow.offer.take.outcomeSkipped : undefined
    if (persisted || persistedSkipped) {
      await commitRecoverySave(flow, persisted, !!persistedSkipped)
      return
    }
    // Tickets off → the stop flow saves directly and never asks (the same
    // contract resolveStopFlow's 'save-direct' carries).
    if (!ticketsEnabled) {
      await commitRecoverySave(flow, undefined, true)
      return
    }
    // A-6 — 'auto' PARITY. A mid-pack customer (>2 sessions left) had no
    // conversion conversation, so the live stop flow burns silently for them
    // and writes NO outcome row; asking 成約/不成約 here would pollute exactly
    // the coaching labels that design protects. Recovery must behave the same.
    // The mode decides ALONE whether to ask: an already-burned mid-pack
    // customer still must not be asked — they just have nothing left to burn.
    if (flow.packId && resolveOutcomeMode(flow.pack) === 'auto') {
      await runRecoveryAutoRedeem(flow)
      return
    }
    setOutcomeFlow(flow)
  }

  /** A-6's silent leg — handleAutoFlow's twin, dated to the visit and tagged
   *  recovery. Same undo-able toast, so the staff can still reverse it. */
  async function runRecoveryAutoRedeem(flow: RecoveryFlow) {
    // Already burned for this visit → nothing to move, and still nothing to
    // ask. Straight to the save, with the same skipped-outcome shape.
    if (flow.alreadyRedeemed) {
      await settleRecoveryAnswer(flow, undefined, true)
      await commitRecoverySave(flow, undefined, true)
      return
    }
    const from = flow.pack?.remaining ?? 0
    await redeemSessionAction({
      packId: flow.packId!,
      customerId: flow.dest.customerId,
      redeemedOn: flow.dayYmd,
      appointmentId: flow.dest.appointmentId ?? null,
      recovery: true,
    })
      .then((res) => {
        if (res.ok) {
          toast.success(
            tPacks('autoRedeemed', { from, to: from - 1 }),
            res.redemptionId
              ? {
                  action: {
                    label: tPacks('undo'),
                    onClick: () =>
                      void undoRedemptionAction(res.redemptionId!).then((u) =>
                        u.ok ? toast.success(tPacks('undone')) : toast.error(tPacks('redeemFailed')),
                      ),
                  },
                }
              : undefined,
          )
        } else if (res.error === 'already_redeemed') {
          toast.info(t('recoverAlreadyRedeemed'))
        } else {
          toast.error(
            tPacks(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'),
          )
        }
      })
      .catch(() => toast.error(tPacks('redeemFailed')))
    // A-3 + A-4: the money phase is over, so the answer may now be certified.
    await settleRecoveryAnswer(flow, undefined, true)
    await commitRecoverySave(flow, undefined, true)
  }

  /** A-3 + A-4 — the ONE place an answer becomes certified: after its money
   *  phase settled, never before. The take stamp (which recovery reads as
   *  "already resolved, don't ask") and the in-memory retry latch move
   *  together, so neither can claim money that did not complete. */
  async function settleRecoveryAnswer(
    flow: RecoveryFlow,
    outcome: SessionOutcome | undefined,
    skipped: boolean,
  ) {
    answeredRef.current.set(flow.offerId, { outcome, skipped })
    if (flow.offer.kind === 'take') {
      await stampTakeOutcome(flow.offer.take.takeId, outcome, skipped)
    }
  }

  /** The take's audio / the draft's transcript, through the SAME writers the
   *  normal path uses (R-B1). No parallel recovery writer exists. */
  async function commitRecoverySave(
    flow: RecoveryFlow,
    outcome: SessionOutcome | undefined,
    outcomeSkipped: boolean,
  ) {
    // Past this line the abort effect stands down: clearing the offer is what
    // a successful save DOES.
    flowRef.current = { offerId: flow.offerId, committing: true }
    try {
      const { offer: o, dest } = flow
      if (o.kind === 'take') {
        const blob = await loadTakeBlob(o.take.takeId)
        if (!blob || blob.size === 0) {
          // Unreadable — corrupted, or the owner gate refused (uid changed
          // since the banner loaded). Do NOT delete: a delete here would let
          // the wrong user destroy the owner's audio. The TTL owns cleanup.
          // A-1 ④: SAY SO. Returning silently here left the staffer looking at
          // a banner that had just eaten their tap, with the money already
          // moved.
          toast.error(t('recoverSaveFailed'))
          setRecoveredTake(null)
          return
        }
        globalPipeline.start(blob, {
          locale,
          customers,
          duration: flow.durationSec,
          appointmentId: dest.appointmentId || undefined,
          appointmentCustomerId: dest.customerId,
          // WITH the outcome the take now qualifies for the existing autosave
          // cohort (isServerJobEligible) — it saves without a review detour.
          outcome,
          outcomeSkipped,
          recordingSessionId: o.take.recordingSessionId,
          takeId: o.take.takeId,
        })
        setRecoveredTake(null)
        return
      }
      // DRAFT — the transcript already exists, so it saves DIRECTLY through
      // the in-tab autosave's own chokepoint caller. No 4th writer shape.
      const d = o.draft
      // B-2: a transport failure throws rather than returning { error } — an
      // unhandled rejection here would leave the flow latched forever.
      let res: Awaited<ReturnType<typeof saveKaruteRecordInline>>
      try {
        res = await saveKaruteRecordInline({
          customerId: dest.customerId,
          transcript: d.transcript,
          summary: d.summary,
          entries: d.entries.map((e) => ({
            category: e.category as EntryCategory,
            content: e.content,
            sourceQuote: e.sourceQuote,
            confidenceScore: e.confidenceScore,
          })),
          duration: d.duration,
          appointmentId: dest.appointmentId || undefined,
          outcome,
          recordingSessionId: d.recordingSessionId,
        })
      } catch {
        toast.error(t('recoverSaveFailed'))
        return
      }
      if ('error' in res) {
        // The offer STAYS — the staffer retries, and A-4's latch makes that
        // retry cost nothing: no popup, no second burn, no second pack sale.
        toast.error(t('recoverSaveFailed'))
        return
      }
      clearDraft()
      if (d.takeId) void deleteTake(d.takeId)
      setRecoveredDraft(null)
      setRecoveredTake(null)
      toast.success(t('recoverSaved'))
    } finally {
      releaseRecoverySave()
    }
  }

  /** Grant + resume. Uses the FROZEN flow the gate opened with, never a re-read
   *  of live state — the record can only ever save to the customer whose
   *  consent was just attested (same rule ReviewScreen's frozen pending payload
   *  enforces). */
  async function handleGrantRecoveryConsent() {
    const flow = consentFlow
    if (!flow || consentSubmitting) return
    setConsentSubmitting(true)
    setConsentError(null)
    let r: Awaited<ReturnType<typeof grantCustomerConsent>>
    try {
      r = await grantCustomerConsent(flow.dest.customerId, { method: 'VERBAL' })
    } catch {
      // A transport failure must release the dialog, not wedge it.
      setConsentSubmitting(false)
      setConsentError(tc('somethingWentWrong'))
      return
    }
    setConsentSubmitting(false)
    if (!r.ok) {
      setConsentError(r.error)
      return
    }
    setConsentFlow(null)
    await afterRecoveryConsent(flow)
  }

  /** The recovery popup's 保存 — the SAME money legs the normal path runs
   *  (mirror of onResolve below), plus D5's guard and D6's post-settle stamp. */
  function handleRecoveryResolve(
    flow: RecoveryFlow,
    outcome: SessionOutcome,
    redeemPack: boolean,
    newPack: NewPackInput | null,
  ) {
    // First tap wins — a double-tap must never fire two burns or create two
    // packs (the live prod bug the normal path's ref closed).
    if (recoveryResolvingRef.current) return
    recoveryResolvingRef.current = true
    setRecoveryResolving(true)
    setOutcomeFlow(null)
    void (async () => {
      const packPromise = newPack
        ? (async () => {
            const res = await createPackAction({
              customerId: flow.dest.customerId,
              kind: 'pack',
              packSize: newPack.size,
              unitPrice: newPack.unitPrice,
              // The purchase happened on the RECORDING's day, not today.
              purchasedAt: flow.dayYmd,
            })
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
          })().catch(() => toast.error(tPacks('packCreateFailed')))
        : Promise.resolve()
      const redeemPromise =
        redeemPack && flow.packId
          ? redeemSessionAction({
              packId: flow.packId,
              customerId: flow.dest.customerId,
              // The burn belongs to the VISIT, not to today.
              redeemedOn: flow.dayYmd,
              appointmentId: flow.dest.appointmentId ?? null,
              // D5 + D7: the customer-day guard, and the recovery-resolved tag.
              recovery: true,
            })
              .then((res) => {
                if (res.ok) toast.success(tPacks('redeemDone'))
                else if (res.error === 'already_redeemed')
                  toast.info(t('recoverAlreadyRedeemed'))
                else
                  toast.error(
                    tPacks(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'),
                  )
              })
              .catch(() => toast.error(tPacks('redeemFailed')))
          : Promise.resolve()
      await Promise.allSettled([packPromise, redeemPromise])
      // A-3 — the stamp lands HERE, not before the legs. Stamping first told
      // recovery "this answer is settled" while the money might still fail or
      // be interrupted, and a stamped take is never re-asked.
      await settleRecoveryAnswer(flow, outcome, false)
      await commitRecoverySave(flow, outcome, false)
    })()
  }

  // What the stop flow shows, decided by the pack state (single source —
  // resolveOutcomeMode): conversion dialog / repurchase dialog / nothing at all.
  const outcomeMode = resolveOutcomeMode(targetPack)

  // Slim heads-up: the picked customer is booked under another staff. The
  // record still saves under the signed-in user (currentStaffName).
  const otherStaffBanner =
    !scheduleMismatch &&
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
    // saveBinding, never bound*: the burn must hit the session's own customer
    // (delta-verify catch 8/2 — boundCustomerId falls through to the schedule).
    if (targetPack && saveBinding.customerId) {
      const from = targetPack.remaining
      void redeemSessionAction({
        packId: targetPack.id,
        customerId: saveBinding.customerId,
        // undefined for walk-in targets → null (no booking to link)
        appointmentId: saveBinding.appointmentId ?? null,
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

  // NOTE (PR-B1): the "reopen the unsaved draft in ReviewScreen" branch is
  // gone with the 復元する button that was its only entry point. A recovered
  // draft now saves DIRECTLY through saveKaruteRecordInline (D3) — the
  // transcript already exists, so a second trip through review only stood
  // between the staffer and the record.

  // Map nextAppointment to the target card shape. Status key comes
  // from the server (sessions/page.tsx derives it from now vs the
  // appointment window — keeps this client component pure for
  // React Compiler). 新規 (isFirstTimeVisit) flows from the brief.
  const targetAppointment: RecordTargetAppointment | null =
    recState !== 'idle' && !target
      ? // Anonymous record-anyway take in flight: the card must show its
        // unbound state — falling through to nextAppointment would claim the
        // schedule's customer as the one being recorded (blind-round P1 8/2).
        null
      : live && target
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

  // F2: every OPEN starts clean — a hung take's in-flight write must not
  // pre-lock the NEXT take's dialog as 保存中 (the finally reset in onResolve
  // only fires when that write eventually settles; a request that never
  // settles left the guard stuck true forever under the old code).
  function openOutcomeDialog() {
    // This take already resolved once — never reopen for it (see
    // outcomeResolvedRef above). Real re-opens (a new take) clear the latch
    // at handleStartRecording/handleStartAnyway/handleDiscard, not here.
    if (outcomeResolvedRef.current) return
    resolvingOutcomeRef.current = false
    setResolvingOutcome(false)
    setOutcomeOpen(true)
  }

  // Which flow the 録音を使用 tap runs, once it's cleared to run at all.
  function runStopFlow() {
    // Tickets off OR the pack data on screen isn't this session's customer
    // (mismatch/anonymous): straight save — no burn, no 成約/回数券 dialog
    // (resolveStopFlow's contract).
    const flow = resolveStopFlow({ ticketsEnabled, canRunOutcome, outcomeMode })
    if (flow === 'save-direct') handleUseRecording(undefined, true)
    else if (flow === 'auto-redeem') handleAutoFlow()
    else openOutcomeDialog()
  }

  // C-1 (Greptile F1): the supersession gate. It sits BEFORE the fork above on
  // purpose — handleAutoFlow burns a pack session and the outcome dialog can
  // create one, so asking here means a キャンセル costs nothing and moves no
  // money. An errored run stays documented as legitimate to supersede.
  //
  // 'autosaving' is NOT the safe state the first cut claimed (fix round 5): the
  // save runs from a PASSIVE EFFECT in ProcessingIndicator, not from the
  // transition itself, so a tap landing between the 'autosaving' commit and its
  // effect flush would supersede a finished-but-unsaved run and drop the whole
  // transcription in silence.
  //
  // autosaveSettled covers the WHOLE unsettled window — the pre-dispatch gap
  // AND the in-flight save (fix round 7): an in-flight save can come back
  // {error}, and a run superseded before that answer arrives can't fall back to
  // review (the fallback is runId-guarded, so it no-ops for a superseded run),
  // which is the same silent loss one step later. Once the record is persisted
  // the flag flips and taps pass with zero friction.
  //
  // What the staff sees is the D-1 conservative direction — extra dialog beats
  // silent loss. Opening the confirm is itself a React update and React flushes
  // that commit's pending passive effects before rendering it, so by the time
  // the dialog is on screen the save is at least in flight; a 中断して開始 then
  // is an explicit, informed call rather than something that happened to them.
  // Every effect keyed on pipeline.state is in that same flush, which is why
  // the dialog-hygiene effect above has to span 'autosaving' too (fix round 6)
  // — narrower, it clears the flag this tap just set.
  function handleUseRecordingTap() {
    if (pipeline.state === 'processing') {
      // The old run survives server-side — say so, don't ask.
      if (globalPipeline.serverOwned) toast.info(t('supersedeServerNotice'))
      else {
        setShowSupersedeDialog(true)
        return
      }
    }
    // Live singleton, not the render snapshot: the snapshot is one commit stale
    // in exactly the window this closes.
    if (
      globalPipeline.state === 'autosaving' &&
      !globalPipeline.autosaveSettled &&
      !globalPipeline.serverSavedRecordId
    ) {
      setShowSupersedeDialog(true)
      return
    }
    runStopFlow()
  }

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
          // Belt: visual only, state-driven (resolvingOutcome only spans the
          // pack/redeem write, not the whole post-resolve window) — the real
          // guard is outcomeResolvedRef inside openOutcomeDialog.
          disabled={resolvingOutcome}
          onClick={handleUseRecordingTap}
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
          // prompt. Reads the LIVE consent state (consentGranted, refreshed
          // by refreshConsent below) — NOT the SSR consentDate prop, which is
          // fetched once at page load and never updates: a mid-session grant
          // via handleGrantConsent would otherwise still stamp false for
          // every photo taken after. The card itself freezes this value
          // per-photo at capture time (retries reuse the frozen value).
          takenWithConsent={consentGranted}
        />
      )}
      {/* consentDate is nextAppointment-derived — under a schedule mismatch it
          would show the OTHER customer's consent as if it covered this session
          (blind-round catch, same class as the briefing leak). */}
      {!scheduleMismatch && (
        <div className="flex justify-center">
          <ConsentPill consentDate={consentDate} />
        </div>
      )}
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

      {/* PR-B1 — the ONE crash-recovery banner. It replaces the two amber
       *  strips (draft-recover + take-recover) that each carried a 破棄
       *  button: ⚖ 8/20 abolished discarding at this point entirely, because
       *  reaching this banner is a SYSTEM failure and the staffer's only job
       *  is to land the record. Shown only while fully idle, so it never
       *  competes with a live recording. */}
      {offer && offerStartedAt !== null && offerDayYmd && (
        <RecoveryBanner
          // B-1: bound-ness is the DESTINATION's existence, never whether a
          // display name happened to resolve.
          bound={!!destination}
          customerName={destination?.customerName ?? null}
          recordedAt={`${formatCompactDateJst(new Date(offerStartedAt), locale)} ${hmInJst(
            new Date(offerStartedAt),
          )}`}
          dayLabel={formatCompactDateJst(new Date(offerStartedAt), locale)}
          lengthLabel={
            offerDurationSec > 0
              ? t('target.durationMinutes', { n: Math.max(1, Math.round(offerDurationSec / 60)) })
              : null
          }
          recordedBy={currentStaffName}
          // B-7: after a re-point the take's bind-time snapshot belongs to the
          // OTHER booking, so the menu is re-read from the NEW destination's
          // own row on the recording day rather than dropped.
          service={
            repointed
              ? (loadedFacts?.bookings.find((b) => b.id === repointed.appointmentId)?.service ??
                null)
              : offer.kind === 'take'
                ? offer.take.target?.service
                : null
          }
          ticketState={ticket.state}
          pack={ticket.pack}
          // A-5: 回数券の状態を確認できません + a retry, instead of a save that
          // silently skips the money question.
          factsFailed={ticketsEnabled && dayFacts.status === 'failed'}
          onRetryFacts={() => setFactsAttempt((n) => n + 1)}
          onRepoint={() => setRepointOpen(true)}
          onSave={handleRecoverySaveTap}
          saving={recoverySaving}
          // Disabled while the day's truth is still in flight.
          saveDisabled={factsBlockSave}
        />
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
            {!scheduleMismatch && <RepurchaseCueBanner pack={targetPack} />}
            {!scheduleMismatch && visitRhythm && (
              <div className="overflow-hidden rounded-2xl border border-border">
                <VisitRhythmPanel rhythm={visitRhythm} segment={visitSegment} />
              </div>
            )}
            {!scheduleMismatch && (
              <ClosingTacticHint segment={visitSegment} hasTicketPack={targetHasTicketPack} />
            )}
            {!scheduleMismatch && nextAppointment && (
              <Suspense
                key={nextAppointment.customerId}
                fallback={<BriefLoadingCard />}
              >
                <StreamingBriefCard
                  aiBriefPromise={aiBriefPromise}
                  fallbackBrief={brief}
                  customerName={nextAppointment.customerName}
                />
              </Suspense>
            )}
          </div>
          <div className="self-start">{recorderColumn}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <RecordingTargetCard
            appointment={targetAppointment}
            nearbyBookings={nearbyBookings}
            onSwitchBooking={live ? undefined : handleSwitchBooking}
            onChooseCustomer={
              showNoTargetActions ? () => setShowCustomerPicker(true) : undefined
            }
            onRecordWithoutCustomer={showNoTargetActions ? handleStartAnyway : undefined}
          />
          {otherStaffBanner}
          {!scheduleMismatch && <RepurchaseCueBanner pack={targetPack} />}
          {!scheduleMismatch && visitRhythm && (
            <div className="overflow-hidden rounded-2xl border border-border">
              <VisitRhythmPanel rhythm={visitRhythm} segment={visitSegment} />
            </div>
          )}
          {!scheduleMismatch && (
            <ClosingTacticHint segment={visitSegment} hasTicketPack={targetHasTicketPack} />
          )}
          {/* A-3 (8/19): no target → NO brief block. With a null customer
              PreSessionBriefCard falls through to its own 「録音対象が…」
              explainer, which stacked a SECOND empty-state card under the new
              one (approved mock A2 has exactly one). The block only ever had
              content to show for a bound customer anyway. */}
          {!scheduleMismatch && nextAppointment && (
            <Suspense
              key={nextAppointment.customerId}
              fallback={<BriefLoadingCard />}
            >
              <StreamingBriefCard
                aiBriefPromise={aiBriefPromise}
                fallbackBrief={brief}
                customerName={nextAppointment.customerName}
              />
            </Suspense>
          )}
          {!showNoTargetActions && (
            <div className="mx-auto w-full max-w-md">{recorderColumn}</div>
          )}
        </div>
      )}

      <LiveTranscriptCard connected={false} lines={[]} />

      {/* recentRecordings is keyed on nextAppointment's customer (names,
          services, karute numbers) — same mismatch guard as the briefing. */}
      {!scheduleMismatch && <RecentRecordingsCard recordings={recentRecordings} />}

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
        isReturningCustomer={resolveReturningForOutcome(brief)}
        saving={resolvingOutcome}
        mode={outcomeMode === 'repurchase' ? 'repurchase' : 'conversion'}
        pack={targetPack}
        packPresets={packPresets}
        staffCanCustomize={staffCanCustomizePacks}
        previousPack={previousPack}
        onCancel={() => setOutcomeOpen(false)}
        onResolve={(outcome, redeemPack, newPack: NewPackInput | null) => {
          // First tap wins — see the guard declaration above.
          if (resolvingOutcomeRef.current) return
          resolvingOutcomeRef.current = true
          // ONE resolution per take (Greptile P1, #679) — latch immediately,
          // before any async work, so a re-tap of 録音を使用 during the
          // upcoming await window can't reopen this dialog for the same take.
          outcomeResolvedRef.current = true
          // D6 (R-B3) — the answer is persisted ONTO the take, so a crash
          // between the money writes and the karute save recovers it instead
          // of re-asking (the double-burn doorway ⚖ 8/21 closes). The takeId is
          // captured HERE but STAMPED after the legs settle (A-3): a stamp
          // means "this answer's money phase completed", and recovery skips
          // the popup for a stamped take — so stamping first would certify
          // money that might still fail. Captured now because handleUseRecording
          // below hands the take to the pipeline and clears the recorder.
          const takeIdForStamp = globalRecorder.takeId
          setResolvingOutcome(true)
          setOutcomeOpen(false)
          // 成約/購入した with the inline picker filled → the pack is created
          // HERE, at the moment of sale (conservation law: the count-from-N
          // needs an input moment, not a profile errand).
          void (async () => {
            try {
              // F1 (PR-0 fix round): pack-create and redemption are TWO
              // INDEPENDENT writes, each with its own toast + catch — a
              // THROWN createPackAction (its getSynqedClient init failure is
              // now guarded, but this must hold even if a future edit
              // weakens that) must never skip the redemption, and vice
              // versa. The old sequential `await` coupled them: a throw from
              // the first silently skipped the second entirely.
              // saveBinding, never bound* (#670's law) — carried through the F1 restructure.
              // Hoisted capture: property narrowing dies at the async-IIFE
              // boundary; a const carries it through (saveBinding is stable
              // for the life of this handler).
              const packCustomerId = saveBinding.customerId
              const packPromise =
                newPack && packCustomerId
                  ? (async () => {
                      const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000)
                        .toISOString()
                        .slice(0, 10)
                      const res = await createPackAction({
                        customerId: packCustomerId,
                        kind: 'pack',
                        packSize: newPack.size,
                        unitPrice: newPack.unitPrice,
                        purchasedAt: jstToday,
                      })
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
                    })().catch(() => toast.error(tPacks('packCreateFailed')))
                  : Promise.resolve()
              // Redemption records the VISIT (which already happened) —
              // awaited here only so the single-flight guard above covers it
              // too; still independent of the pack-create above and of
              // whether the transcription/save later succeeds. Failure →
              // toast; the profile pack card is the fallback.
              const redeemPromise =
                redeemPack && targetPack && saveBinding.customerId
                  ? redeemSessionAction({
                      packId: targetPack.id,
                      customerId: saveBinding.customerId,
                      appointmentId: saveBinding.appointmentId ?? null,
                    })
                      .then((res) => {
                        if (res.ok) toast.success(tPacks('redeemDone'))
                        else toast.error(tPacks(res.error === 'below_zero' ? 'redeemNoSessionsLeft' : 'redeemFailed'))
                      })
                      .catch(() => toast.error(tPacks('redeemFailed')))
                  : Promise.resolve()
              await Promise.allSettled([packPromise, redeemPromise])
              // A-3 — stamp only now, with the money phase behind it.
              if (takeIdForStamp) await stampTakeOutcome(takeIdForStamp, outcome)
            } finally {
              resolvingOutcomeRef.current = false
              setResolvingOutcome(false)
            }
          })()
          // 購入した → close the loop: the NEW pack must be registered, or the
          // alert system keeps treating them as nearly-out. One tap to the
          // profile's 登録 dialog.
          if (
            outcome.status === 'success' &&
            !newPack &&
            saveBinding.customerId
          ) {
            const customerId = saveBinding.customerId
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

      {/* PR-B1 — the recovery popup. The SAME PostSessionResolutionDialog the
          normal stop flow opens, packed with facts for the CURRENT 保存先 (a
          re-point re-packs it), and told when this booking's ticket already
          burned so it states 消化済み instead of offering a second one (D4). */}
      {outcomeFlow && (
        <PostSessionResolutionDialog
          open
          customerName={outcomeFlow.dest.customerName}
          isFirstVisit={false}
          // The returning-customer signal is derived for the SCREEN's target,
          // not this one — unknown must never speculatively offer 通常ご来店.
          isReturningCustomer={null}
          saving={recoveryResolving}
          mode={
            resolveOutcomeMode(outcomeFlow.pack) === 'repurchase' ? 'repurchase' : 'conversion'
          }
          pack={
            outcomeFlow.packId && outcomeFlow.pack
              ? { id: outcomeFlow.packId, ...outcomeFlow.pack }
              : null
          }
          alreadyRedeemed={outcomeFlow.alreadyRedeemed}
          packPresets={packPresets}
          staffCanCustomize={staffCanCustomizePacks}
          previousPack={null}
          onCancel={() => {
            setOutcomeFlow(null)
            releaseRecoverySave()
          }}
          onResolve={(outcome, redeemPack, newPack) =>
            handleRecoveryResolve(outcomeFlow, outcome, redeemPack, newPack)
          }
        />
      )}

      {/* PR-B1 — 保存先を変更. The Build A picker in repoint mode: the
          RECORDING day's bookings, the take's own customer pinned, no search
          box (⚖ 8/21 doctrine ⑥). */}
      {repointOpen && offer && (
        <RecordCustomerPickerDialog
          variant="repoint"
          customers={customers}
          // B-8: the pinned row IS the original booking, so listing it again
          // below is a duplicate. Only that EXACT appointment is filtered — the
          // same customer's OTHER bookings that day stay selectable.
          bookings={(loadedFacts?.bookings ?? []).filter(
            (b) => !offerBinding?.appointmentId || b.id !== offerBinding.appointmentId,
          )}
          facts={(loadedFacts?.packs ?? []).map((p) => ({
            id: p.customerId,
            pack: { remaining: p.remaining, size: p.size },
          }))}
          pinned={
            offerBinding
              ? {
                  customerId: offerBinding.customerId,
                  name: offerBinding.customerName,
                  karuteNumber: offerBinding.karuteNumber ?? null,
                }
              : null
          }
          // B-3: the 現在の保存先 badge marks where the save actually lands NOW,
          // which after a re-point is not the pinned original.
          pinnedIsCurrent={!repointed}
          currentAppointmentId={repointed?.appointmentId ?? null}
          dayLabel={offerStartedAt ? formatCompactDateJst(new Date(offerStartedAt), locale) : ''}
          cancelLabel={tc('cancel')}
          onClose={() => setRepointOpen(false)}
          onSelectBooking={(booking) => {
            if (!booking.customerId) {
              setRepointOpen(false)
              return
            }
            repointTo({
              customerId: booking.customerId,
              customerName: booking.customer,
              karuteNumber: booking.karute,
              appointmentId: booking.id,
            })
          }}
          onSelectCustomer={(id) => {
            // The pinned original → back to the take's own binding, appointment
            // and all. A re-point never invents a booking.
            if (offerBinding && id === offerBinding.customerId) {
              repointTo(null)
              return
            }
            // A-7: a searched customer, which only an UNBOUND take can reach —
            // no booking to attach, exactly like the walk-in pick-at-review
            // path this mirrors.
            repointTo({
              customerId: id,
              customerName:
                customers.find((c) => c.id === id)?.name || t('recoverCustomerUnknown'),
              appointmentId: null,
            })
          }}
        />
      )}

      {/* PR-B1 — the recovery save's consent gate. Its customer may not be the
          screen's bound one, so it carries its own FROZEN flow rather than
          overloading the start-gate dialog below. */}
      {consentFlow && (
        <RecordingConsentDialog
          customerName={consentFlow.dest.customerName}
          submitting={consentSubmitting}
          error={consentError}
          onCancel={() => {
            setConsentFlow(null)
            releaseRecoverySave()
          }}
          onConfirm={() => void handleGrantRecoveryConsent()}
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

      {/* お客様を選んで録音 — the no-own-booking card's primary action, dialog v2
          (Liam's 8/19 mock). Opens on today's bookings; typing switches to
          search over every customer.

          Both exits re-enter the screen through a SERVER re-resolve, never a
          client-side binding shortcut: a booking row threads ?appointmentId=
          (so menu/consent/packs/brief are re-read FROM that booking — a
          colleague's still lands on otherStaffBanner, which is the deliberate
          8/19 pick), and a searched customer keeps the pre-existing
          ?customerId= path the 顧客 card's mic uses (bottom-nav.tsx). */}
      {showCustomerPicker && showNoTargetActions && (
        <RecordCustomerPickerDialog
          customers={customers}
          bookings={nearbyBookings}
          facts={customerFacts}
          cancelLabel={tc('cancel')}
          onClose={() => setShowCustomerPicker(false)}
          onSelectBooking={(booking) => {
            setShowCustomerPicker(false)
            router.replace(`/sessions?appointmentId=${encodeURIComponent(booking.id)}`)
          }}
          onSelectCustomer={(id) => {
            setShowCustomerPicker(false)
            router.replace(`/sessions?customerId=${encodeURIComponent(id)}`)
          }}
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

      {/* C-1 — supersession confirm. Same shape as the no-booking prompt
          above (one sibling convention for the page's confirms): キャンセル
          keeps the previous run alive and leaves this take on its review
          screen, so nothing is lost either way. The render gate spans
          'autosaving' too (fix round 5): that transition is the window the tap
          gate now covers, so closing on it would swallow the tap it was opened
          by — as would the dialog-hygiene effect near the state declaration,
          widened with it (fix round 6). Both have to move together; either one
          left narrow is the same dead button. A run that settles past both
          states has nothing left to ask about, and the confirm still goes with
          it. */}
      {showSupersedeDialog &&
        (pipeline.state === 'processing' || pipeline.state === 'autosaving') && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowSupersedeDialog(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('supersedeTitle')}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl"
          >
            <h3 className="text-base font-semibold text-foreground">
              {t('supersedeTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('supersedeDescription')}</p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                size="md"
                className="flex-1"
                onClick={() => setShowSupersedeDialog(false)}
              >
                {tc('cancel')}
              </Button>
              <Button
                variant="default"
                size="md"
                className="flex-1"
                onClick={() => {
                  setShowSupersedeDialog(false)
                  runStopFlow()
                }}
              >
                {t('supersedeConfirm')}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* D3 — discard-with-photos confirmation. Only reachable from
          handleDiscard (the explicit 破棄 button); the save path
          (handleUseRecording) never shows this. Button pairing follows
          CustomerMemoryCard's delete-confirm convention (spike-lifted/
          memory/CustomerMemoryCard.tsx): the irreversible action is
          destructive, never the accent/default fill. */}
      {showDiscardPhotosDialog && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            onClick={() => !discardingPhotos && handleDiscardCancel()}
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
              {t(
                staffCanDeletePhotos
                  ? 'sessionPhotos.discardPhotosDescription'
                  : 'sessionPhotos.discardPhotosKeepOnlyDescription',
                { n: sessionPhotosForDiscardDialog().length },
              )}
            </p>
            <Button
              variant="outline"
              size="md"
              className="w-full"
              onClick={handleDiscardCancel}
              disabled={discardingPhotos}
            >
              {tc('cancel')}
            </Button>
            <div className="flex gap-3">
              {/* Keep-only state (no records.delete): 残す is the dialog's
                  COMMIT action and must not read as a twin of キャンセル —
                  R13 gives the commit action the solid accent fill, which
                  Button's `default` variant is (--color-accent, retinted to
                  blue-600 by globals.css). With the destructive button
                  present, 残す stays outline exactly as before. */}
              <Button
                variant={staffCanDeletePhotos ? 'outline' : 'default'}
                size="md"
                className="flex-1"
                onClick={handleDiscardKeepPhotos}
                disabled={discardingPhotos}
              >
                {t('sessionPhotos.discardPhotosKeep')}
              </Button>
              {staffCanDeletePhotos && (
                <Button
                  variant="destructive"
                  size="md"
                  className="flex-1"
                  onClick={handleDiscardDeletePhotos}
                  disabled={discardingPhotos}
                >
                  {t('sessionPhotos.discardPhotosDelete')}
                </Button>
              )}
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
