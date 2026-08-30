'use client'

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  listOwnTakes,
  loadTakeBlob,
  readTakeOutcome,
  stampDiscardPending,
  stampTakeOutcome,
  type DiscardPending,
  type RecoverableTake,
} from '@/lib/karute/take-store'
import {
  discardTranscriptSupported,
  persistReviewDiscardTranscript,
  runDiscardTranscript,
  sweepDiscardTranscripts,
} from '@/lib/recording/discard-transcript'
import { loadInbox, useRecordingsInbox } from '@/lib/recordings/inbox-store'
import type { InboxRow } from '@/lib/recordings/inbox'
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
import { discardRecordingWithReason } from '@/actions/recording-discard'
import { BELOW_FLOOR_SEC } from '@/lib/recording/discard-floor'
import { myDiscardCountThisMonth } from '@/actions/recording-discards'
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
import { RecordingDiscardReasonDialog } from './RecordingDiscardReasonDialog'
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
import { RecordingsInboxCard } from './RecordingsInboxCard'
import { RecoveryAutoSavedNotice } from './RecoveryAutoSavedNotice'
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

/** Per-leg settlement (F-3). 'none' = never asked for · 'pending' = asked for,
 *  not settled · 'done' = provably finished (succeeded, or the server refused
 *  it in a way retrying cannot change). Only 'pending' legs ever re-run. */
export type LegState = 'none' | 'pending' | 'done'

/**
 * An answer and the state of its money legs. Recorded per offer AND stamped
 * durably, so a retry after a failed karute save re-runs only what never
 * settled (A-4 + F-3): a done leg never fires twice — no second 回数券 sale —
 * and a pending one is always re-offered, so a transient blip cannot cost a
 * burn in silence.
 */
export interface RecoveryAnswer {
  outcome: SessionOutcome | undefined
  skipped: boolean
  legs?: { burn: LegState; pack: LegState }
  /** The 新しい回数券 the staffer registered — kept so a resumed pack leg can
   *  re-run with the SAME numbers rather than re-asking. */
  newPack?: NewPackInput
  /** Remaining sessions at answer time, for the auto leg's 残N→残N-1 toast. */
  burnFrom?: number
  /** The silent mid-pack leg (A-6) — drives which toast the burn shows. */
  auto?: boolean
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
  /**
   * PR-B2 — the app started this save ITSELF on relaunch, with no 保存する tap.
   *
   * ONE divergence from the tapped flow, and only one: where the tap would open
   * a dialog the auto path stands down instead. No outcome popup (the record
   * lands with NO outcome and the notice says 結果未回答 — R-B2 forbids
   * inventing one), and no consent grant dialog opened unprompted (a
   * non-current consent leaves the amber banner exactly as it is today, for the
   * human tap to handle). Everything else — money legs, certification, the
   * writers — is the same code.
   */
  autoFinish: boolean
  /** The green notice's identity line, composed at FREEZE time from the same
   *  formatters the banner uses (A-1: nothing downstream re-reads render
   *  scope). Empty string on the tapped path, which shows no notice. */
  meta: string
}

/** A-5 — the day's facts are three worlds, not two. `failed` is what the
 *  server's explicit `unavailable` flag maps to; it is NOT an empty day. */
/**
 * A-5 — the day's facts are three worlds, not two. `failed` is what the
 * server's explicit `unavailable` flag maps to; it is NOT an empty day.
 *
 * F-1(b): a settled state carries the KEY it was fetched for. Without it,
 * "loaded" was read as "loaded for the CURRENT destination" — but the effect
 * that marks the state stale runs after the render that changed the key, so a
 * pick landing in that window started its save against the previous
 * customer's facts (null pack ⇒ the burn question silently dropped, exactly
 * what A-5 exists to prevent).
 */
type DayFactsState =
  | { status: 'loading' }
  | { status: 'loaded'; key: string; facts: RecoveryDayFacts }
  | { status: 'failed'; key: string }

/** PR-B2 — what the green auto-saved notice reports. Frozen once, at the two
 *  points a save is KNOWN COMPLETE in this session. */
interface AutoSavedNotice {
  meta: string
  ticketState: RecoveryTicketState
  pack: { remaining: number; size: number } | null
  /** The 結果 was never answered and never skipped (R-B2's unanswered cohort). */
  outcomeOwed: boolean
  /** null while a take's pipeline run is still in flight — the notice renders
   *  only once a record provably exists. The draft path has it immediately. */
  recordId: string | null
  /** The pipeline run the take was handed to; null on the draft path. */
  runId: number | null
}

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
  // ⚖ 2026-08-21 (Liam) — BOOKING-KEYED, exactly like the server guard this
  // mirrors (actions/packs.ts, D5). A destination WITH a booking asks one
  // question: has THIS booking already burned? A same-day burn keyed to some
  // other booking (or to no booking at all) belongs to a different visit —
  // his salons book a double visit as two bookings, and each takes its own
  // ticket. The customer-day key survives only for an UNBOUND destination,
  // where the appointment index has nothing to see and the day is the only
  // dedupe key there is. Client and server must key the same way or the
  // banner and the guard can disagree about money.
  const burned = appointmentId
    ? facts.redeemed.appointmentIds.includes(appointmentId)
    : facts.redeemed.customerIds.includes(customerId)
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

  // P5-A (⚖ 8/17): the REQUIRED written-reason gate. One state, one dialog,
  // one confirm handler for every deliberate-discard chokepoint — the value
  // says only which one is asking, so the sites cannot drift apart.
  // 'recorder' = the 破棄 button on the recorded-take card (after the photos
  // confirm, when it applies); 'review' = ReviewScreen's 破棄.
  // ⚖ 8/26 rider (banner dead-loop exit): 'pipeline-error' = the empty-
  // transcript refusal card (mirrors 'review' exactly — the take was handed
  // to the pipeline long ago); 'banner' = a below-floor take offered at the
  // recovery banner (its own snapshot latch — see bannerDiscardSnapshotRef).
  const [discardReasonFor, setDiscardReasonFor] = useState<
    'recorder' | 'review' | 'pipeline-error' | 'banner' | null
  >(null)
  const [discardReasonSubmitting, setDiscardReasonSubmitting] = useState(false)
  const [discardReasonError, setDiscardReasonError] = useState<string | null>(null)
  // The REF is the real single-flight guard — state reads stale mid-tick, so
  // two taps landing in the same tick would both pass a state check and file
  // the discard twice (the outcome dialog's resolvingOutcomeRef precedent).
  // The `submitting` prop and the disabled button are the visible half.
  const discardReasonSubmittingRef = useRef(false)
  // The photo decision, RECORDED not acted on (fix round 1). 写真も削除 used to
  // delete the customer's photos server-side the moment the photos dialog was
  // answered — i.e. BEFORE the reason gate, the step that is supposed to be the
  // final commitment. Cancelling the gate (or any server refusal) then left the
  // photos irreversibly gone with the take still sitting there. The deletion now
  // runs from the confirm handler's success branch; this ref is the decision in
  // the meantime, and cancel clears it.
  const pendingPhotoDeleteRef = useRef(false)
  // Discard-intent latch (fix round 1). While the gate is open for a recorder
  // take, an in-flight 使用 must not hand THAT take to transcription — it used
  // to, because proceedDiscard (which bumps useRecordingGen) now runs only
  // after the server round-trip, leaving the whole dialog lifetime unguarded.
  // Same latch idiom as outcomeResolvedRef, keyed by take so it can only ever
  // stop the take it was opened for. null = no gate open for the recorder.
  const discardIntentRef = useRef<{ takeId: string | null } | null>(null)
  // ⚖ 8/26 rider — the 'banner' origin's offer, SNAPSHOT AT OPEN (wiring spec
  // item 2): confirm acts on this, never on live offer/offerBinding/
  // offerDurationSec, the same read-it-first rule discardIntentRef follows.
  // Null for every other origin.
  const bannerDiscardSnapshotRef = useRef<{
    takeId: string
    recordingSessionId: string | null
    customerId: string | null
    appointmentId: string | null
    durationSec: number
  } | null>(null)

  // Single-flight guard for the outcome dialog's 保存: a double-tap must never
  // create two pack rows or fire two redemptions (live prod bug — the DB's
  // partial unique index on pack_redemptions(appointment_id) can't block the
  // walk-in NULL case, and pack creation has no dedupe of its own). The REF is
  // the real guard — the synchronous re-entry check (state reads stale
  // mid-tick, same reason usingRecording below is a ref). The state feeds the
  // dialog's `saving` prop as belt-and-braces — that future edit has arrived
  // (B3/B4 deferred-unmount exit): the dialog keeps rendering with
  // saving=true through the ~200ms closing window after onResolve calls
  // setOutcomeOpen(false), so the resolvingOutcome/saving belt is now live
  // and load-bearing, not just insurance.
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

  // ⚖ 8/25 ruling B (staff half): the staffer sees their OWN discard count for
  // the month, and only their own. Read once on mount, alongside the inbox it
  // renders next to. null = unknown (never shown), never a zero we cannot back.
  const [myDiscardsThisMonth, setMyDiscardsThisMonth] = useState<number | null>(null)
  useEffect(() => {
    let alive = true
    void myDiscardCountThisMonth().then((n) => {
      if (alive) setMyDiscardsThisMonth(n)
    })
    return () => {
      alive = false
    }
  }, [])
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

  // A2-2: finish any discard whose words a reload left owing. Fire-and-forget —
  // it touches nothing this page renders (a stamped take is already excluded
  // from every offer above), so there is nothing to cancel on unmount.
  useEffect(() => {
    void sweepDiscardTranscripts()
  }, [])

  // 録音履歴 (Build F1) — the folded inbox. Mounting subscribes AND fetches, so
  // every navigation onto this page recomputes; the store also refreshes itself
  // when a pipeline run ends.
  const inbox = useRecordingsInbox()
  // Name resolution for inbox rows whose take carries no bind-time snapshot
  // (server rows never do). The page already holds the customer list, so this
  // costs no extra read.
  const customerNameById = useMemo(
    () => new Map(customers.map((c) => [c.id, c.name])),
    [customers],
  )

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
    // PR-B2: the green notice reports the PREVIOUS recording's save. A new one
    // starting is where that report stops being the screen's news. The epoch
    // bump makes that stick against an armAutoNotice refetch still in flight.
    noticeEpochRef.current++
    setAutoNotice(null)
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

  // ⚰ THE DISCARD CLEANUP IS GONE (packet item A2-1).
  //
  // It existed to stop a deliberate 破棄 from leaving an orphan
  // recording_sessions row that the 録音履歴 inbox could only render as 失敗 —
  // an unclearable false alarm in 要対応 for seven days. It solved that by
  // HARD-DELETING the session row.
  //
  // P5-A made that self-defeating: the written reason lands in core's discard
  // ledger keyed on `recording_session_id`, and this cleanup then deleted that
  // very key moments later, fire-and-forget, with no app-side signal. The
  // flagship deliverable could be voided ~200 ms after it landed.
  //
  // So the row SURVIVES a reasoned discard now, and A2-3 gives the inbox the
  // honest thing to render for it: a grayed 破棄済み row, off the same ledger
  // (see lib/recordings/inbox.ts). The orphan-as-失敗 problem the cleanup was
  // built for is solved by naming the row correctly instead of destroying it.
  //
  // SYSTEM/abandoned cleanup is untouched — deleteRecordingSessionWithClient
  // keeps its other call sites (the recordings action + the facade route).

  /** `keepTake` (A2-2): the take has been stamped `discardPending` and its audio
   *  is owed to the discard record — the persist run deletes it, not this. Every
   *  other discard still takes the audio with it, exactly as before. */
  function proceedDiscard(keepTake = false) {
    toastDroppedErrorPhotos()
    // A2-1: NO session cleanup here any more. The reason row keys on this
    // session id, so deleting the row would delete the trace.
    // Invalidate any in-flight handleUseRecording: its post-await body must
    // not hand a take the staff just discarded to the pipeline.
    useRecordingGen.current++
    // The discarded take is done — its resolution latch (if any) must not
    // carry over and wedge the NEXT take's dialog shut.
    outcomeResolvedRef.current = false
    // belt reset — see handleStartRecording
    resolvingOutcomeRef.current = false
    setResolvingOutcome(false)
    discardRecording({ keepTake })
    setPhase('idle')
  }

  function handleDiscard() {
    if (sessionPhotosForDiscardDialog().length > 0) {
      setShowDiscardPhotosDialog(true)
      return
    }
    openDiscardReason('recorder')
  }

  // ── P5-A: the written-reason gate ────────────────────────────────────────
  // Ordering (⚖ 8/17 / packet P5-A A-2): the photos confirm still comes first
  // where it applies — it decides what happens to the PHOTOS — and this dialog
  // is always LAST, the final commitment gate for the discard itself.

  function openDiscardReason(origin: 'recorder' | 'review' | 'pipeline-error' | 'banner') {
    // Latch WHICH take this gate is for, at the moment it opens. Only the
    // recorder chokepoint can race 使用 — the review take was handed to the
    // pipeline long before, so there is nothing left to invalidate there.
    discardIntentRef.current = origin === 'recorder' ? { takeId: globalRecorder.takeId } : null
    // ⚖ 8/26 rider — the banner offer, frozen at open. offer.kind === 'take'
    // always holds here: onDiscard is wired only when belowFloor is true,
    // which is itself gated on offer.kind === 'take'.
    bannerDiscardSnapshotRef.current =
      origin === 'banner' && offer?.kind === 'take'
        ? {
            takeId: offer.take.takeId,
            recordingSessionId: offer.take.recordingSessionId,
            customerId: offerBinding?.customerId ?? null,
            appointmentId: offerBinding?.appointmentId ?? null,
            durationSec: offerDurationSec,
          }
        : null
    setDiscardReasonError(null)
    setDiscardReasonFor(origin)
  }

  function cancelDiscardReason() {
    if (discardReasonSubmittingRef.current) return
    // A cancelled gate must leave NOTHING behind: no latched intent wedging the
    // next 使用, and no armed photo deletion.
    discardIntentRef.current = null
    pendingPhotoDeleteRef.current = false
    setDiscardReasonFor(null)
    setDiscardReasonError(null)
  }

  /**
   * The one confirm handler for every chokepoint.
   *
   * FAILS CLOSED, deliberately. A deliberate discard is the one recording
   * event that leaves no trace anywhere else, so if the trace cannot be
   * written — no session id to key the reason row on, or core refusing the row
   * or the receipt — the discard does NOT happen. The take stays exactly where
   * it was, the typed reason stays in the field, and the staff member can
   * retry or cancel. Both server steps are idempotent, so a retry never files
   * anything twice.
   */
  async function confirmDiscardReason(reason: string) {
    const origin = discardReasonFor
    if (!origin || discardReasonSubmittingRef.current) return
    discardReasonSubmittingRef.current = true
    setDiscardReasonSubmitting(true)
    setDiscardReasonError(null)
    try {
      // A banner gate with no frozen snapshot must fail closed HERE — never
      // fall through to the recorder arm below, which would act on the LIVE
      // recorder singleton (awaitRecordingSessionId/globalRecorder.takeId/
      // result/saveBinding) for a take that gate was never opened for. Not
      // reachable through today's wiring (onDiscard only wires for a
      // below-floor take, and openDiscardReason snapshots in the same
      // closure), but a wrong-subject fall-through is exactly what every
      // other latch in this function guards against.
      if (origin === 'banner' && !bannerDiscardSnapshotRef.current) {
        setDiscardReasonError(t('discardReason.failed'))
        return
      }
      // Line-audit BLOCKER-2: the auto-finish effect can start a recovery
      // save with NO tap at all, and this dialog outlives the banner (it
      // renders from the main return, independent of the banner's `{offer &&
      // ...}` guard). A take the pipeline is already processing — or has
      // already saved and deleted — must never receive a reason row: a
      // discard row filed against a SAVED session would outrank the record
      // in the inbox fold (evidence corruption). `recoveredTake` is read
      // here, pre-await, off THIS render's closure — the same freshness the
      // shipped takeChanged check gets from reading globalRecorder.takeId
      // live; no new ref needed.
      //
      // THE FULL SEAL (Greptile P1, resolved): this check alone does not
      // cover a save that starts DURING the awaits below (the mint retry).
      // It doesn't need to — the awaits are protected from the OTHER side.
      // discardReasonSubmittingRef.current is set true above, before any
      // await, and startRecoveryFlow refuses to start ANY save (tap, inbox,
      // auto-finish, repoint continuation — every entry routes through it)
      // while that ref is true. So a save can exist at this gate only if it
      // started BEFORE this confirm call began, which this pre-await check
      // already catches on the live ref. A dedicated post-await recheck was
      // built and mutation-tested here first; the mutation run proved it
      // vacuous (removing it changed no test outcome), because the reverse
      // guard already makes its precondition unreachable. Removed rather
      // than shipped as armor that cannot fire.
      if (
        origin === 'banner' &&
        (recoverySavingRef.current ||
          recoveredTake?.takeId !== bannerDiscardSnapshotRef.current?.takeId)
      ) {
        setDiscardReasonError(t('discardReason.takeChanged'))
        return
      }
      // Live singleton, not the render snapshot — same rule the rest of this
      // component follows for anything read across an await.
      const ctx = globalPipeline.context
      // ⚖ 8/26 rider: 'pipeline-error' mirrors 'review' EXACTLY — both key off
      // the pipeline's captured context, because in both cases the take was
      // handed to the pipeline long before this gate opened.
      const ctxKeyed = origin === 'review' || origin === 'pipeline-error'
      const bannerSnap = origin === 'banner' ? bannerDiscardSnapshotRef.current : null
      // The recorder mints its session id in parallel with getUserMedia, so a
      // fast discard can beat it (G14). Bounded await, exactly as the save
      // path does; the ctx-keyed arms' take was already handed off with
      // whatever id it had, and the banner arm reads its own frozen snapshot —
      // neither has anything left to wait for on the LIVE recorder.
      let recordingSessionId = ctxKeyed
        ? (ctx?.recordingSessionId ?? null)
        : bannerSnap
          ? bannerSnap.recordingSessionId
          : await awaitRecordingSessionId()
      if (!recordingSessionId) {
        // Not "slow" — FAILED. The mint runs once at start() and its promise
        // stays settled, so awaiting it again can only ever return null again;
        // without this the gate dead-ends forever and its retry copy lies. ONE
        // re-mint, bounded the same way, then fail closed honestly. The
        // ctx-keyed arms key off the pipeline context because the recorder was
        // reset at hand-off and no longer knows this take's customer or take
        // id; the banner arm keys off its own snapshot for the same reason —
        // its take is not the recorder's live one either.
        recordingSessionId = ctxKeyed
          ? await globalRecorder.retryRecordingSessionMint({
              customerId: ctx?.appointmentCustomerId ?? null,
              appointmentId: ctx?.appointmentId ?? null,
              takeId: ctx?.takeId ?? null,
            })
          : bannerSnap
            ? await globalRecorder.retryRecordingSessionMint({
                customerId: bannerSnap.customerId,
                appointmentId: bannerSnap.appointmentId,
                takeId: bannerSnap.takeId,
              })
            : await globalRecorder.retryRecordingSessionMint()
      }
      if (!recordingSessionId) {
        setDiscardReasonError(t('discardReason.failed'))
        return
      }
      // The take must still be the one this gate was opened for. If 使用 won the
      // race while the dialog was open, that take is already in transcription —
      // discarding it here would file a reason for audio the pipeline still
      // owns. Say so instead of failing silently or acting on the wrong take.
      // Read ONCE, here, and reused by everything below that acts on the
      // recorder's take: this line is where the live singleton is proven to
      // still be this gate's subject, so a second read further down would be a
      // value nothing checked.
      const liveTakeId = globalRecorder.takeId
      if (origin === 'recorder' && liveTakeId !== discardIntentRef.current?.takeId) {
        setDiscardReasonError(t('discardReason.takeChanged'))
        return
      }
      const res = await discardRecordingWithReason({
        recordingSessionId,
        takeId:
          (ctxKeyed ? ctx?.takeId : bannerSnap ? bannerSnap.takeId : liveTakeId) ?? null,
        reason,
        durationSeconds: ctxKeyed
          ? (ctx?.duration ?? 0)
          : bannerSnap
            ? bannerSnap.durationSec
            : (result?.durationMs ?? 0) / 1000,
        // `|| null`: a walk-in target carries id='' — the same coercion the
        // save binding does, so the receipt records null rather than ''.
        customerId:
          (ctxKeyed
            ? ctx?.appointmentCustomerId
            : bannerSnap
              ? bannerSnap.customerId
              : saveBinding.customerId) || null,
        appointmentId:
          (ctxKeyed
            ? ctx?.appointmentId
            : bannerSnap
              ? bannerSnap.appointmentId
              : saveBinding.appointmentId) || null,
        pipeline: ctxKeyed && globalPipeline.serverOwned ? 'server' : 'in_tab',
        jobState: null,
      })
      if (!res.ok) {
        setDiscardReasonError(t('discardReason.failed'))
        return
      }
      // The review arm closes its own dialog, in its tail — see below. Every
      // other arm keeps the close-then-act order it always had.
      if (origin !== 'review') setDiscardReasonFor(null)
      // Ids read BEFORE the await, handed in — the same read-it-first rule
      // proceedDiscard obeys for the recorder singleton.
      if (origin === 'review') {
        // A2-2: the words are already IN HAND — this take was transcribed in-tab
        // long before the gate opened, and globalPipeline only resets inside
        // finishReviewDiscard below. Persist them BEFORE anything deletes the
        // audio; on a failure the take is stamped and kept back instead, so
        // finishReviewDiscard is handed no take id to delete and the audio
        // retry can still run.
        //
        // THE DIALOG STAYS UP FOR THE WHOLE ROUND-TRIP. globalPipeline.reset()
        // lives inside finishReviewDiscard, so until it runs the page is still
        // rendering ReviewScreen — and ReviewScreen's 保存 is a SECOND save
        // writer that knows nothing about discardReasonSubmittingRef (the
        // reverse guard covers startRecoveryFlow, not it). Closing the modal
        // first left that 保存 live for the length of the persist: a tap there
        // filed a real karute against a session that already carries a staff
        // discard row (evidence corruption, doctrine R2) and raced onSaved's
        // deleteTake against the stamp, losing the audio either way. The
        // submitting-locked, backdrop-sealed dialog is the fence.
        const pending: DiscardPending = {
          recordingSessionId,
          durationSeconds: ctx?.duration ?? 0,
          locale,
          stampedAt: Date.now(),
        }
        const keepTake = !(await persistReviewDiscardTranscript(
          ctx?.takeId,
          pending,
          globalPipeline.result?.transcript ?? '',
        ))
        setDiscardReasonFor(null)
        finishReviewDiscard(recordingSessionId, keepTake ? null : ctx?.takeId)
        // The kept take is stamped, and reset() above is a re-render, not a
        // remount — the mount sweep will not run again in this page life. Kick
        // the audio retry now, exactly as the recorder arm does: waiting for a
        // navigation away and back risks the 7-day TTL pruning words that were
        // in hand and free at the moment of failure.
        if (keepTake && ctx?.takeId) void runDiscardTranscript(ctx.takeId, pending)
      } else if (origin === 'pipeline-error') {
        // Line-audit BLOCKER-1: this origin never owns a draft.
        // finishReviewDiscard's clearDraft() is correct for 'review' — draft.ts
        // is single-slot, and ReviewScreen (saveDraft's only caller in the
        // repo) has just written THIS run's draft, so the clear can only ever
        // hit its own. A pipeline-error run never reached 'review' (the run
        // threw, or the server job never had a client-side result at all), so
        // it never wrote a draft — clearDraft() here could only destroy a
        // FOREIGN crash-surviving draft from an unrelated earlier session.
        // Inline cleanup, scoped to this run's own take only.
        if (ctx?.takeId) void deleteTake(ctx.takeId)
        setRecoveredTake((prev) => (prev && prev.takeId === ctx?.takeId ? null : prev))
        globalPipeline.reset()
      } else if (bannerSnap) {
        // ⚖ 8/26 rider case (b): idle cleanup only — no pipeline reset (nothing
        // is running); harmless if added, but pointless, so it stays out.
        void deleteTake(bannerSnap.takeId)
        // SHOULD-FIX-3: keyed to the snapshot, not unconditional — a take
        // swap during the awaits above (handleInboxSaveTake promoting a
        // different take into recoveredTake) must clear THAT offer, never a
        // take this confirm never touched. Defense in depth behind the
        // BLOCKER-2 guard above, which already refuses a swap caught before
        // the awaits; this covers one that lands during them.
        setRecoveredTake((prev) => (prev && prev.takeId === bannerSnap.takeId ? null : prev))
        setRepointed(null)
      } else {
        // A2-2 (⚖ 8/20): ABOVE the accidental-tap floor a reasoned discard keeps
        // its words. Nothing here has been transcribed yet, so the audio is what
        // the words have to come from — stamp the take BEFORE anything can
        // delete it (the stamp is what survives a crash, and what keeps a
        // discarded take out of every recovery offer), then hold it back from
        // proceedDiscard until the persist run lands.
        //
        // BELOW the floor nothing is kept and nothing is transcribed (⚖ spend
        // gate): an accidental tap has no words worth a Deepgram call, and the
        // take goes with the discard exactly as it always did. Same on the
        // phone, which has no route to persist through this round.
        //
        // The stamp's span, honestly: it is written AFTER core accepted the
        // discard, so a crash in that window leaves the discard filed and the
        // take unstamped — offered back as a normal recovery. Pre-existing
        // shape, not closed here; closing it means stamping before the server
        // call and unstamping on refusal.
        //
        // takeId is the id proven live at the takeChanged guard above — the
        // same read the payload used, never a second look at the singleton.
        const takeId = liveTakeId
        const durationSeconds = (result?.durationMs ?? 0) / 1000
        const pending: DiscardPending = {
          recordingSessionId,
          durationSeconds,
          locale,
          stampedAt: Date.now(),
        }
        const keepTake =
          takeId !== null &&
          durationSeconds >= BELOW_FLOOR_SEC &&
          discardTranscriptSupported() &&
          (await stampDiscardPending(takeId, pending))
        // The photos die HERE, past the gate — never before it. Still ahead of
        // proceedDiscard() because its discardRecording() wipes the strip these
        // reads depend on (the ordering constraint that was always in this
        // file; only the starting line moved).
        await runPendingPhotoDelete()
        proceedDiscard(keepTake)
        if (keepTake && takeId) void runDiscardTranscript(takeId, pending)
      }
      // Latch released LAST — after proceedDiscard, never before it (fix round
      // 2). It used to clear the moment core accepted the discard, i.e. ahead
      // of the awaited photo deletion: the dialog was closed, the phase was
      // still 'recorded' and useRecordingGen had not moved yet, so for the
      // whole deletion window a 使用 tap passed every guard and handed
      // transcription a take the SERVER HAD ALREADY DISCARDED. The latch has
      // to outlive the window it was built to cover. (The review/pipeline-
      // error/banner arms never had a latch to release — openDiscardReason
      // sets null for all three — so this is a no-op there, kept on the
      // shared line so the arms cannot drift.)
      discardIntentRef.current = null
    } finally {
      discardReasonSubmittingRef.current = false
      setDiscardReasonSubmitting(false)
    }
  }

  /** ReviewScreen's discard, everything after the reason has landed.
   *
   *  A2-1: the session cleanup that used to run here is gone for the same
   *  reason as its recorder-side twin — the reason row keys on this session id.
   *  `recordingSessionId` is still taken as a parameter: the inbox now needs
   *  that row to EXIST to render its 破棄済み line, and keeping the argument
   *  documents which session this discard belongs to at the call site. */
  function finishReviewDiscard(
    recordingSessionId: string | null,
    takeId: string | null | undefined,
  ) {
    void recordingSessionId
    // Deliberate discard → drop the draft + take too, or they reappear
    // as recovery offers for a session the user intentionally threw away.
    clearDraft()
    if (takeId) void deleteTake(takeId)
    setRecoveredDraft(null)
    setRecoveredTake(null)
    globalPipeline.reset()
  }

  function handleDiscardCancel() {
    // Full abort — the recording stays exactly as it was, nothing proceeds.
    setShowDiscardPhotosDialog(false)
  }

  /**
   * The photo half of a discard — RUN ONLY ONCE THE DISCARD HAS LANDED.
   *
   * Deleting a customer's photos is irreversible and server-side, so it may not
   * happen one step before the final commitment gate. It used to: 写真も削除
   * deleted them the moment the photos dialog was answered, and cancelling the
   * reason gate (or hitting any server refusal) left the photos gone with the
   * take still sitting there — strictly worse than never having tapped.
   *
   * The marks still have to precede proceedDiscard(): its discardRecording()
   * clears the store and the strip these reads depend on. That constraint never
   * changed — only the line this work starts from.
   */
  async function runPendingPhotoDelete() {
    if (!pendingPhotoDeleteRef.current) return
    pendingPhotoDeleteRef.current = false
    const photos = sessionPhotosForDiscardDialog()
    const donePhotos = photos.filter((p) => p.status === 'done')
    // §7: an 'uploading' photo hasn't landed server-side yet — mark it for
    // delete-after-settle (the store fires the delete itself the moment
    // that upload resolves to 'done'; nothing to do on 'error').
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
    setDiscardingPhotos(true)
    // Best-effort: collect failures, one toast if any fail — deleteCustomerPhoto
    // never throws (catches internally), so Promise.all is safe here.
    const results = await Promise.all(
      donePhotos.map((p) => deleteCustomerPhoto(p.customerId, p.serverId as string)),
    )
    setDiscardingPhotos(false)
    const failed = results.filter((r) => !r.success).length
    if (failed > 0) toast.error(t('sessionPhotos.discardDeleteFailed', { n: failed }))
  }

  /** Records the DECISION only — see runPendingPhotoDelete for why nothing is
   *  destroyed here. */
  function handleDiscardDeletePhotos() {
    pendingPhotoDeleteRef.current = true
    setShowDiscardPhotosDialog(false)
    openDiscardReason('recorder')
  }

  function handleDiscardKeepPhotos() {
    pendingPhotoDeleteRef.current = false
    setShowDiscardPhotosDialog(false)
    openDiscardReason('recorder')
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
      // The generation only moves once the discard COMMITS, and since P5-A that
      // is after a whole dialog round-trip. So also drop the take when a discard
      // gate is merely OPEN for it: handing a take the staff is mid-破棄 to
      // transcription resurfaces it as a save offer (and bills the run) — the
      // exact outcome the doctrine forbids.
      const discardIntent = discardIntentRef.current
      if (discardIntent && discardIntent.takeId === globalRecorder.takeId) return
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
    const key = factsKey
    setDayFacts({ status: 'loading' })
    void getRecoveryDayFacts({
      date: offerDayYmd,
      // BOTH ids (F-1a). The ORIGINAL binding so the picker can always offer
      // the take's own customer back, AND the CURRENT destination so its 回数券
      // row exists — after a search re-point the destination is neither pinned
      // nor booked that day, and sending only the binding meant the server
      // built no pack row for them at all. The request used to be byte-identical
      // across a re-point, which is why the "destination-keyed" refetch was
      // pure cost.
      pinnedCustomerIds: [offerBinding?.customerId, destination?.customerId],
    }).then((f) => {
      if (cancelled) return
      setDayFacts(
        f.unavailable ? { status: 'failed', key } : { status: 'loaded', key, facts: f },
      )
    })
    return () => {
      cancelled = true
    }
    // factsKey collapses every input — re-fetch only when one genuinely moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factsKey])

  // FRESH means "settled for the key this render is actually asking about".
  const factsFresh = dayFacts.status !== 'loading' && dayFacts.key === factsKey
  const loadedFacts = factsFresh && dayFacts.status === 'loaded' ? dayFacts.facts : null
  const factsFailed = factsFresh && dayFacts.status === 'failed'
  const ticket = resolveRecoveryTicketState({
    facts: loadedFacts,
    customerId: destination?.customerId ?? null,
    appointmentId: destination?.appointmentId ?? null,
  })
  // A-5: money questions need the day's truth — for THIS destination. Tickets
  // off → there is no money question at all, so a failed read must NOT strand
  // the record (it only costs the picker its detail lines).
  const factsBlockSave = ticketsEnabled && !loadedFacts

  const [repointOpen, setRepointOpen] = useState(false)
  const [recoverySaving, setRecoverySaving] = useState(false)
  // PR-B2 — the green auto-saved notice (mock B0a/B0b). SESSION-SCOPED: it
  // reports what THIS launch did, so a new recording clears it and nothing
  // persists it across launches.
  //   ACCEPTED CEILING (stated, not fixed): if the app closes mid-flight and
  //   the save completes server-side, the next launch shows NO notice — the
  //   karute simply exists. A missed notice is fine; a false one never is, and
  //   a persisted notice ledger would be a second source of truth about money.
  const [autoNotice, setAutoNotice] = useState<AutoSavedNotice | null>(null)
  // F2 — the notice's own generation. Bumped wherever the notice stops being
  // this screen's news (a new recording, an aborted flow), so armAutoNotice's
  // in-flight refetch cannot land a report on a screen that moved on.
  const noticeEpochRef = useRef(0)
  // One-shot per offer: the auto-run fires ONCE for an offerId per mount cycle.
  // Set BEFORE the async start (React strict-mode double-invokes effects on the
  // same mount, so the ref survives and the second invoke is a no-op), and
  // never cleared — a FAILED auto-attempt must fall back to the banner and the
  // human retry machinery rather than loop.
  const autoRunRef = useRef<string | null>(null)
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
  // F-5 — the abort's cancellation token. Nulling flowRef tore down the UI but
  // could not stop the awaited chain: a resumed step would re-open a popup for
  // a dead offer, move money for an aborted flow, or resurrect flowRef and hand
  // the OLD take's blob to the pipeline while a new recording was live. Every
  // await boundary re-checks the generation it captured and bails when stale.
  const flowGenRef = useRef(0)

  function releaseRecoverySave() {
    recoverySavingRef.current = false
    recoveryResolvingRef.current = false
    flowRef.current = null
    flowGenRef.current++
    setRecoverySaving(false)
    setRecoveryResolving(false)
  }

  // A-1 ③ — the abort. If the offer a flow was saving disappears before its
  // write began (the staffer starts a NEW recording, another tab settles the
  // session), tear the flow down: leaving it up means dialogs bound to a dead
  // offer and a latch nothing will ever release. Deliberately stands down once
  // the commit is under way — that path clears the offer itself, on purpose.
  const activeOfferId = offer ? recoveryOfferId(offer) : null
  useEffect(() => {
    const f = flowRef.current
    // F-6: the deferred start and the picker are cleaned up even when NO flow
    // is running — that is precisely the state during the pendingStart wait.
    // Left behind, the picker re-opened by itself when the offer came back, and
    // a save the staffer never re-authorised fired with it.
    setPendingStart(null)
    setRepointOpen(false)
    // `f.committing` is DEFENSIVE, and deliberately kept unpinned (N3): a
    // successful commit clears the offer itself, so without it this effect
    // would read that success as an abort. It has TWO consequences, not one:
    //   ① releaseRecoverySave does not run twice — every generation check
    //     lives BEFORE a commit begins, so nothing reads flowGenRef after that
    //     point (which is also why commitRecoverySave carries no check of its
    //     own).
    //   ② the SAME short-circuit gates setRepointed(null) three lines below.
    //     On the DRAFT path a failed saveKaruteRecordInline deliberately keeps
    //     the offer alive so the staffer can retry, and that retry rebuilds
    //     `destination = repointed ?? offerBinding`. With `repointed` wrongly
    //     nulled it resolves back to the ORIGINAL binding, and the
    //     persisted-answer branch commits straight to it — a WRONG-CUSTOMER
    //     save, in silence. That is the consequence worth the guard.
    // It stays because the moment anyone adds a generation check after a
    // commit begins, this is what keeps it honest.
    if (!f || f.committing || f.offerId === activeOfferId) return
    // F2: an aborted flow's offer is gone, so any report about it is gone too.
    // Reached only when `committing` is false, so no armAutoNotice for THIS
    // flow can be in flight — it is the NEXT flow's protection, not this one's.
    noticeEpochRef.current++
    setConsentFlow(null)
    setOutcomeFlow(null)
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

  // ── 録音履歴 (Build F1) ───────────────────────────────────────────────────
  // The inbox row's 開く / 確認する opens the karute this session produced.
  // 確認する ALSO settles the take: the record exists, the staffer is looking at
  // it right now, so the un-settled audio that made the row 確認待ち has done its
  // job. The row decays to 保存済み and the 要対応 count drops by one.
  function handleInboxOpenRecord(row: InboxRow) {
    if (!row.karuteRecordId) return
    if (row.state === 'awaiting-check' && row.takeId) {
      void deleteTake(row.takeId).then(() => loadInbox())
    }
    router.push(`/karute/${row.karuteRecordId}` as Parameters<typeof router.push>[0])
  }

  /**
   * 保存する / 再試行 on an inbox row — the SAME recovery save the banner runs,
   * parameterized by THIS row's take instead of the newest one.
   *
   * It promotes the chosen take into the recovery offer and then enters the
   * flow through its own deferred-start seam (`pendingStart`), which waits for
   * that destination's day facts before freezing the ticket. No second save
   * writer exists, and none is added here: an unbound take opens the same
   * picker `handleRecoverySaveTap` opens, whose exit continues the save.
   */
  function handleInboxSaveTake(row: InboxRow) {
    if (recoverySavingRef.current || !row.takeId) return
    const wanted = row.takeId
    void (async () => {
      // Re-read rather than trusting the rendered row: the take may have been
      // saved or swept since the list was folded, and offering audio that is
      // gone is exactly the lie this feature exists to end.
      const take = (await listOwnTakes()).find((tk) => tk.takeId === wanted)
      if (!take) {
        void loadInbox()
        return
      }
      // A surviving review draft normally wins the banner; an explicit tap on a
      // specific take is the staffer overriding that, so the draft stands down
      // for this offer.
      setRecoveredDraft(null)
      setRepointed(null)
      setRecoveredTake(take)
      const dest: RecoveryDestination | null = take.target
        ? {
            customerId: take.target.customerId,
            customerName: take.target.customerName,
            karuteNumber: take.target.karuteNumber,
            appointmentId: take.target.appointmentId || null,
          }
        : null
      // Bound → start as soon as the day's facts land. Unbound → the picker IS
      // the save's first step (repointTo continues it), same as the banner.
      if (dest) setPendingStart(dest)
      else setRepointOpen(true)
    })()
  }

  /** A-1 ① — FREEZE, then run. Everything downstream takes this object as an
   *  argument; nothing re-reads `offer`/`destination`/`ticket` from render
   *  scope, so the flow survives whatever the page does underneath it. */
  function startRecoveryFlow(dest: RecoveryDestination, autoFinish = false) {
    // Greptile P1, reverse direction: a save must not START while a discard
    // gate is mid-commit — confirmDiscardReason's pre-await check (above the
    // mint retry) only catches a save already running BEFORE the confirm;
    // this closes the other side by refusing any NEW save for as long as
    // discardReasonSubmittingRef stays true, which spans the discard's own
    // server round-trip too. The two guards together are the whole seal — no
    // save can start anywhere between a discard confirm and its landing.
    // Accepted: if this spends the auto-finish attempt (autoRunRef) while a
    // discard is submitting, that's fine — a failed discard leaves the take
    // at the banner for a manual save, a successful one leaves nothing to
    // save.
    if (
      recoverySavingRef.current ||
      discardReasonSubmittingRef.current ||
      !offer ||
      !offerDayYmd ||
      factsBlockSave
    )
      return
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
      autoFinish,
      // Composed here, at the freeze, from the same formatters the banner
      // renders — 「山本 結衣様 · 8月18日(月) 14:35 · 52分」 (mock B0a/B0b).
      meta: autoFinish
        ? [
            `${dest.customerName}${t('target.honorific')}`,
            offerStartedAt !== null
              ? `${formatCompactDateJst(new Date(offerStartedAt), locale)} ${hmInJst(
                  new Date(offerStartedAt),
                )}`
              : null,
            offerDurationSec > 0
              ? t('target.durationMinutes', { n: Math.max(1, Math.round(offerDurationSec / 60)) })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : '',
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
    // F-1(b): `factsFresh` — NOT factsBlockSave. The facts effect is declared
    // above this one, so in the single commit where a pick lands it sets
    // {status:'loading'} while THIS effect still reads the render's already
    // captured values. Gating on the key match is what makes the wait real:
    // the flow starts only once the facts for the picked destination are in.
    //   ACCEPTED (N2): if that fetch FAILS, the deferred start is dropped
    //   silently — no toast fires for it. Safe and visible rather than
    //   invisible: the banner is already showing 回数券の状態を確認できません
    //   with its retry, the destination the staffer picked is on screen, and
    //   one tap on 保存する resumes. Nothing is lost, so this stays as-is.
    if (!pendingStart || !factsFresh || recoverySavingRef.current) return
    const dest = pendingStart
    setPendingStart(null)
    startRecoveryFlow(dest)
    // startRecoveryFlow closes over this render's facts, which is exactly what
    // the gate above just proved fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingStart, factsFresh])

  /**
   * PR-B2 — AUTO-FINISH. Stopping always saves; after a crash the app finishes
   * the save ITSELF on relaunch. The amber banner survives only as last-resort
   * residue for the cases this cannot honestly complete (doctrine ⑦).
   *
   * Every gate below is a REFUSAL to guess, not a convenience:
   *   · fresh, readable day facts — the same `factsBlockSave` gate the tap
   *     honours, so a save can never silently skip the money question;
   *   · idle — implied by `offer` itself (takeOffer/draftOffer both require it);
   *   · not already running, and not already attempted for this offer.
   * Consent is checked one step later, inside beginRecoverySave, because that
   * is the ONE place it is checked for both paths (fail-closed, and on the auto
   * path silent — no grant dialog opens unprompted).
   *
   * It saves to `offerBinding`, NOT to `destination`: the auto path may only
   * land the recording where the recording itself was bound — the same
   * customer a crash-free stop would have saved to. A `repointed`/`pendingStart`
   * destination means a HUMAN is at the picker choosing one, and their pick
   * belongs to their own flow (which asks the 結果 question, because they are
   * standing there to answer it). Unbound takes have no binding at all and stay
   * with the banner and its picker.
   */
  useEffect(() => {
    if (!activeOfferId || factsBlockSave || !factsFresh) return
    if (recoverySavingRef.current || autoRunRef.current === activeOfferId) return
    // Spent on the first evaluation either way — an offer the auto path may not
    // touch must not become auto-touchable later (e.g. the moment a staffer's
    // pick lands a destination on it).
    autoRunRef.current = activeOfferId
    if (!offerBinding || repointed || pendingStart) return
    startRecoveryFlow(offerBinding, true)
    // Same closure rule as the deferred start above: startRecoveryFlow freezes
    // THIS render's facts, which the gate just proved fresh for this key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOfferId, factsFresh, factsBlockSave])

  /** Consent gate, then the outcome question, then the save. Fail CLOSED: an
   *  unreadable consent opens the grant dialog and the save stays locked —
   *  identical rule to ReviewScreen's save-time gate (the server enforces it
   *  again either way). */
  async function beginRecoverySave(flow: RecoveryFlow) {
    const gen = flowGenRef.current
    let consentCurrent = false
    try {
      const { consent: row } = await getCustomerConsent(flow.dest.customerId)
      consentCurrent = isConsentCurrent(row)
    } catch {
      consentCurrent = false
    }
    // F-5: the offer died while we were away — the abort already released
    // everything, so resuming here would re-open a dialog bound to a dead
    // offer, or move money for a flow the staffer abandoned.
    if (gen !== flowGenRef.current) return
    if (!consentCurrent) {
      // FAIL-CLOSED, and SILENT on the auto path: auto-finish never opens the
      // grant dialog unprompted (a consent attestation is a human act, and a
      // dialog nobody asked for is exactly the question this whole path exists
      // to remove). It stands down; the amber banner and its tap are unchanged.
      if (flow.autoFinish) {
        releaseRecoverySave()
        return
      }
      setConsentError(null)
      setConsentFlow(flow)
      return
    }
    await afterRecoveryConsent(flow)
  }

  async function afterRecoveryConsent(flow: RecoveryFlow) {
    const gen = flowGenRef.current
    // A-4 + F-2 — this offer's money phase already ran. Never re-open the
    // popup; resume only the legs that did NOT settle, then save.
    const answered = answeredRef.current.get(flow.offerId) ?? (await loadPersistedAnswer(flow))
    if (gen !== flowGenRef.current) return
    if (answered) {
      await resumeRecoveryLegs(flow, answered)
      return
    }
    // Tickets off → the stop flow saves directly and never asks (the same
    // contract resolveStopFlow's 'save-direct' carries).
    if (!ticketsEnabled) {
      await certifyAndCommit(flow, { outcome: undefined, skipped: true })
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
    // PR-B2 — the auto path's ONE divergence. The tap opens the 結果 popup
    // here; auto-finish must not (a notice, never a question), so it lands the
    // record with NO outcome and NOTHING burned, and the green notice says
    // 結果未回答. R-B2: never a fabricated outcome, never a fabricated
    // outcomeSkipped — those are the staff's own acts. The karute's OutcomeCard
    // is where the answer is given, and where a burn can still follow.
    if (flow.autoFinish) {
      await commitRecoverySave(flow, undefined, false, null)
      return
    }
    setOutcomeFlow(flow)
  }

  /**
   * F-2 — the answer as it survived a RELOAD.
   *
   * A take carries its own stamp. A DRAFT's answer used to live only in the
   * in-memory latch, so a reload between "money settled, save failed" and the
   * retry re-opened the popup and minted a SECOND 回数券 sale — and a phone
   * WebView being killed in that window is this lane's whole premise, not an
   * exotic case. The draft already carries the take id it deletes on success;
   * the stamp rides through it.
   *
   * ponytail: a legacy draft with NO takeId keeps the in-memory latch only —
   * it has no durable anchor to hang an answer on, and inventing one is a
   * storage migration this fix does not need.
   */
  async function loadPersistedAnswer(flow: RecoveryFlow): Promise<RecoveryAnswer | null> {
    if (flow.offer.kind === 'take') {
      const t = flow.offer.take
      if (!t.outcome && !t.outcomeSkipped) return null
      return {
        outcome: t.outcome,
        skipped: !!t.outcomeSkipped,
        legs: t.outcomeLegs,
        newPack: t.outcomeNewPack ?? undefined,
      }
    }
    const takeId = flow.offer.draft.takeId
    if (!takeId) return null
    const stamped = await readTakeOutcome(takeId)
    if (!stamped || (!stamped.outcome && !stamped.outcomeSkipped)) return null
    return {
      outcome: stamped.outcome,
      skipped: !!stamped.outcomeSkipped,
      legs: stamped.outcomeLegs,
      newPack: stamped.outcomeNewPack ?? undefined,
    }
  }

  /** F-3 — re-run ONLY the legs that never settled, then save. A leg already
   *  recorded done never fires again (no second pack sale); a leg that failed
   *  transiently is always re-offered (no silent money loss). */
  async function resumeRecoveryLegs(flow: RecoveryFlow, answered: RecoveryAnswer) {
    const pending = answered.legs
      ? (answered.legs.burn === 'pending' ? 1 : 0) + (answered.legs.pack === 'pending' ? 1 : 0)
      : 0
    if (pending === 0) {
      // Every leg settled BEFORE this session (pre-crash), so this session's
      // own legs prove nothing new — the notice falls through to the day's
      // refetched facts, or to the pre-save state (F1's null).
      await commitRecoverySave(flow, answered.outcome, answered.skipped, null)
      return
    }
    await runRecoveryLegs(flow, answered)
  }

  /** A-6's silent leg — handleAutoFlow's twin, dated to the visit and tagged
   *  recovery. Same undo-able toast, so the staff can still reverse it. */
  async function runRecoveryAutoRedeem(flow: RecoveryFlow) {
    // Already burned for this visit → nothing to move, and still nothing to
    // ask. Straight to the save, with the same skipped-outcome shape.
    if (flow.alreadyRedeemed) {
      await certifyAndCommit(flow, { outcome: undefined, skipped: true })
      return
    }
    await runRecoveryLegs(flow, {
      outcome: undefined,
      skipped: true,
      legs: { burn: 'pending', pack: 'none' },
      burnFrom: flow.pack?.remaining ?? 0,
      auto: true,
    })
  }

  /**
   * F-3 — the money phase, per leg.
   *
   * A leg is CERTIFIED only when it provably finished: it succeeded, or the
   * server provably refused it (the DB index / the customer-day guard / an
   * empty pack). A transient failure — a reject, a network drop, or the guard
   * being unable to READ the history — certifies nothing, keeps the banner,
   * and is re-offered on the next attempt. Before this, allSettled plus
   * per-leg catches certified everything, so a blip cost the burn permanently
   * while telling the staffer it had already been used.
   */
  async function runRecoveryLegs(flow: RecoveryFlow, answer: RecoveryAnswer) {
    const gen = flowGenRef.current
    const legs = { ...(answer.legs ?? { burn: 'none' as LegState, pack: 'none' as LegState }) }
    let transient = false
    /**
     * F1 — what the burn leg's server ACK actually PROVED, this session.
     *
     * Deliberately NOT derived from `legs.burn === 'done'` downstream: that bit
     * certifies below_zero too, which means the pack was EMPTY and nothing
     * moved. This is the finer answer, and it is a definitive server ACK rather
     * than a guess — which is exactly what the green notice needs when its own
     * day-facts refetch cannot be reached (R-B4's second choice).
     * `null` = no burn leg ran, so this session proved nothing either way.
     */
    let burnAck: RecoveryTicketState | null = null

    // The legacy residual: a leg stamped 'pending' by a build that did not yet
    // persist the payload. It can never be re-run — the size and price are
    // gone — so it must not loop and must not stay silent. LAND THE KARUTE
    // (doctrine: the record is the artifact that matters), say plainly that
    // the sale was lost, and name where to re-enter it. Marked done so the
    // next attempt does not repeat this.
    if (legs.pack === 'pending' && !answer.newPack) {
      legs.pack = 'done'
      toast.error(t('recoverPackSaleLost'))
    }

    const packPromise =
      legs.pack === 'pending' && answer.newPack
        ? createPackAction({
            customerId: flow.dest.customerId,
            kind: 'pack',
            packSize: answer.newPack.size,
            unitPrice: answer.newPack.unitPrice,
            // The purchase happened on the RECORDING's day, not today.
            purchasedAt: flow.dayYmd,
          })
            .then((res) => {
              if (res.ok) {
                legs.pack = 'done'
                toast.success(
                  tPacks('packCreated', {
                    size: answer.newPack!.size,
                    price: answer.newPack!.unitPrice.toLocaleString('ja-JP'),
                  }),
                )
              } else {
                transient = true
                toast.error(tPacks('packCreateFailed'))
              }
            })
            .catch(() => {
              transient = true
              toast.error(tPacks('packCreateFailed'))
            })
        : Promise.resolve()

    const burnPromise =
      legs.burn === 'pending' && flow.packId
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
              if (res.ok) {
                legs.burn = 'done'
                burnAck = 'redeemed'
                if (answer.auto) {
                  const from = answer.burnFrom ?? 0
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
                  toast.success(tPacks('redeemDone'))
                }
              } else if (res.error === 'already_redeemed' || res.error === 'below_zero') {
                // PROVABLE refusals: the ticket is already spent for this
                // visit, or the pack has nothing left. Retrying cannot change
                // either, so the leg is finished — certify it.
                legs.burn = 'done'
                // already_redeemed = a redemption for this visit provably
                // EXISTS (消化済み). below_zero = the pack had nothing to give,
                // so nothing moved (未処理). Same certified leg, opposite money.
                burnAck = res.error === 'already_redeemed' ? 'redeemed' : 'unresolved'
                if (res.error === 'already_redeemed') toast.info(t('recoverAlreadyRedeemed'))
                else toast.error(tPacks('redeemNoSessionsLeft'))
              } else if (res.error === 'guard_unavailable') {
                // F-3: the guard could not READ the history, so nothing burned
                // and nothing is known. Say exactly that — never 消化済み.
                transient = true
                toast.error(t('recoverBurnCheckFailed'))
              } else {
                transient = true
                toast.error(tPacks('redeemFailed'))
              }
            })
            .catch(() => {
              transient = true
              toast.error(tPacks('redeemFailed'))
            })
        : Promise.resolve()

    await Promise.allSettled([packPromise, burnPromise])

    // Certify FIRST, bail second (F-5's ordering rule): a leg that settled is
    // recorded even if the flow was aborted while it was in flight, or the
    // next attempt would run it twice.
    const settled: RecoveryAnswer = { ...answer, legs }
    await settleRecoveryAnswer(flow, settled)
    if (gen !== flowGenRef.current) return
    if (transient) {
      // The banner stays. The retry re-runs only what is still pending.
      releaseRecoverySave()
      return
    }
    await commitRecoverySave(flow, settled.outcome, settled.skipped, burnAck)
  }

  /** No money to move — certify and save in one step. */
  async function certifyAndCommit(flow: RecoveryFlow, answer: RecoveryAnswer) {
    const gen = flowGenRef.current
    await settleRecoveryAnswer(flow, answer)
    // N1: the GENERATION, not `flowRef.current` truthiness. The stamp is an
    // IndexedDB write, so an abort can land inside it — and if the staffer
    // then starts a NEW flow before it resolves, flowRef is non-null again but
    // belongs to someone else. Truthiness let this dead flow sail on and
    // clobber the new flow's flowRef at the commit. Same bail as every other
    // await boundary in this file.
    if (gen !== flowGenRef.current) return
    // No leg ran, so this session proved nothing about the ticket (F1's null).
    await commitRecoverySave(flow, answer.outcome, answer.skipped, null)
  }

  /** A-3 + A-4 + F-2/F-3 — the ONE place an answer becomes certified: after its
   *  money phase settled, never before, and per leg. The durable stamp (which
   *  recovery reads as "already resolved, don't ask") and the in-memory retry
   *  latch move together, so neither can claim money that did not complete.
   *  Drafts stamp through the take id they already carry. */
  async function settleRecoveryAnswer(flow: RecoveryFlow, answer: RecoveryAnswer) {
    answeredRef.current.set(flow.offerId, answer)
    const takeId =
      flow.offer.kind === 'take' ? flow.offer.take.takeId : flow.offer.draft.takeId
    if (takeId) {
      // The pack payload rides the stamp ONLY while its leg is still owed.
      // `legs.pack === 'pending'` says a sale has to be re-run, and a reload
      // that restored the pending flag without the numbers could not re-run
      // it — the leg no-opped and the karute saved with the sale gone. Cleared
      // to null the moment the leg is done, so a later crash cannot re-mint
      // from a stale payload.
      const newPack =
        answer.legs?.pack === 'pending' && answer.newPack ? answer.newPack : null
      await stampTakeOutcome(takeId, answer.outcome, answer.skipped, answer.legs, newPack)
    }
  }

  /**
   * R-B4 — the notice's 回数券 line, in three tiers of decreasing proof. It
   * never invents, and it never prints a number it cannot stand behind.
   *
   *  ① REFETCHED derived truth. The day's redemption rows, read again after
   *     the money settled. This is the answer whenever it is reachable.
   *  ② THIS SESSION'S OWN LEG ACK (`burnAck`). A server ACK, not a guess: a
   *     successful burn or a provable already_redeemed means 消化済み;
   *     below_zero means the pack was empty and nothing moved, so 未処理.
   *     Deliberately NOT the bare `legs.burn === 'done'` bit, which certifies
   *     below_zero too and would call an empty pack a burn. The COUNT is
   *     dropped in this tier — a fresh burn makes `flow.pack`'s remaining
   *     stale by one, and the refetch that would have proven the new number is
   *     exactly what just failed, so the count-free wording is the honest one.
   *  ③ The pre-save state the banner was ALREADY showing. Older, still
   *     server-derived, and all that is left when this session moved nothing.
   */
  async function armAutoNotice(
    flow: RecoveryFlow,
    outcome: SessionOutcome | undefined,
    outcomeSkipped: boolean,
    burnAck: RecoveryTicketState | null,
    recordId: string | null,
    runId: number | null,
  ) {
    // F2 — this notice's epoch, snapshotted BEFORE the await. The refetch is a
    // network round-trip, and a staffer starting a NEW recording inside it has
    // already cleared the notice on purpose; without this the continuation
    // would re-arm the one they just moved past, pointing at the old take.
    // Same class of guard as flowGenRef, scoped to the notice.
    const epoch = noticeEpochRef.current
    const f = ticketsEnabled
      ? await getRecoveryDayFacts({
          date: flow.dayYmd,
          pinnedCustomerIds: [flow.dest.customerId],
        }).catch(() => null)
      : null
    if (epoch !== noticeEpochRef.current) return
    const fresh =
      f && !f.unavailable
        ? resolveRecoveryTicketState({
            facts: f,
            customerId: flow.dest.customerId,
            appointmentId: flow.dest.appointmentId,
          })
        : null
    // Tier ③'s wording, for when neither ① nor ② can speak.
    const preSave: RecoveryTicketState = flow.alreadyRedeemed
      ? 'redeemed'
      : flow.pack
        ? 'unresolved'
        : 'none'
    setAutoNotice({
      meta: flow.meta,
      ticketState: fresh ? fresh.state : !ticketsEnabled ? 'none' : (burnAck ?? preSave),
      pack: fresh ? fresh.pack : burnAck ? null : flow.pack,
      // R-B2: the ONLY honest reading of "the staff still owes an answer" —
      // no outcome was written and no skip was performed.
      outcomeOwed: !outcome && !outcomeSkipped,
      recordId,
      runId,
    })
  }

  // A take's notice waits for its pipeline run to land a record — it appears
  // only when the save is KNOWN COMPLETE (the processing chip owns the in-flight
  // window). Read in RENDER, not inside the effect: the pipeline hook above
  // already re-renders this component on every notify, so this is what turns
  // "a record was published" into a real dependency.
  const pipelineSavedRecordId = globalPipeline.savedRecordId
  useEffect(() => {
    if (!autoNotice || autoNotice.recordId !== null || autoNotice.runId === null) return
    // The run guard is the honesty one: a superseded run's record must never be
    // the one this notice points at.
    if (!pipelineSavedRecordId || globalPipeline.runId !== autoNotice.runId) return
    setAutoNotice((n) =>
      n && n.recordId === null ? { ...n, recordId: pipelineSavedRecordId } : n,
    )
  }, [autoNotice, pipelineSavedRecordId])

  /** The take's audio / the draft's transcript, through the SAME writers the
   *  normal path uses (R-B1). No parallel recovery writer exists. */
  async function commitRecoverySave(
    flow: RecoveryFlow,
    outcome: SessionOutcome | undefined,
    outcomeSkipped: boolean,
    /** F1 — what this session's own burn leg PROVED. See armAutoNotice. */
    burnAck: RecoveryTicketState | null,
  ) {
    // F-5 — DELIBERATELY no generation check in this function, and the trace
    // for it: `committing` is set on the line below, BEFORE any await, and the
    // abort effect stands down on `committing` (adjudicated semantics). The
    // only other writer of flowGenRef is releaseRecoverySave, which runs in
    // this function's own finally. So the generation is provably constant for
    // the whole body — a check here could never fire. Every path INTO this
    // function re-checks its own generation after its own awaits, which is
    // where an abort is actually observable.
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
          // PR-B2: and WITHOUT one, an auto-finishing take qualifies on its own
          // honest flag rather than a fabricated skip (R-B2). Never set on the
          // tapped path, which always arrives with an answer or a real skip.
          recoveryUnanswered: flow.autoFinish && !outcome && !outcomeSkipped,
          // F3: the green notice IS this save's report. Without this marker
          // ProcessingIndicator also fires its generic 保存済み toast and the
          // staff gets the same news twice — the draft path has suppressed its
          // own toast since round 0, and this is the take path's twin.
          // Client-side only, like recoveryUnanswered: never on the job body.
          autoFinish: flow.autoFinish,
          recordingSessionId: o.take.recordingSessionId,
          takeId: o.take.takeId,
        })
        // globalPipeline.start() has already minted this run's id (run()/
        // runServerJob() bump it synchronously before their first await), so
        // this is the run whose completion the notice waits for.
        if (flow.autoFinish) {
          void armAutoNotice(flow, outcome, outcomeSkipped, burnAck, null, globalPipeline.runId)
        }
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
      // The draft's write is synchronous-to-completion, so its notice is armed
      // with the record id right here. The auto path's notice REPLACES the
      // toast — one report of one save, not two.
      if (flow.autoFinish) void armAutoNotice(flow, outcome, outcomeSkipped, burnAck, res.id, null)
      else toast.success(t('recoverSaved'))
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
      // The legs the staffer actually asked for. runRecoveryLegs settles each
      // one independently and certifies only what provably finished (F-3), so
      // the stamp still lands after the money (A-3) but no longer claims a leg
      // that failed.
      await runRecoveryLegs(flow, {
        outcome,
        skipped: false,
        legs: {
          burn: redeemPack && flow.packId ? 'pending' : 'none',
          pack: newPack ? 'pending' : 'none',
        },
        newPack: newPack ?? undefined,
      })
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

  // P5-A: ONE element, rendered in BOTH return branches below. The two
  // deliberate-discard chokepoints therefore share a single component instance
  // shape, a single predicate and a single confirm handler — there is no
  // per-site copy that could drift.
  const discardReasonDialog = (
    <RecordingDiscardReasonDialog
      open={discardReasonFor !== null}
      submitting={discardReasonSubmitting}
      error={discardReasonError}
      onConfirm={(reason) => void confirmDiscardReason(reason)}
      onCancel={cancelDiscardReason}
    />
  )

  // Background pipeline finished → render the SAME ReviewScreen the old
  // blocking flow used, fed from the singleton's result + the context captured
  // at start. The top-corner chip routes here when it's ready.
  if (pipeline.state === 'review' && pipeline.result && pipeline.context) {
    return (
      <>
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
          // P5-A: the reason is now the gate. Nothing is dropped until it has
          // landed — finishReviewDiscard() runs from the confirm handler.
          onDiscard={() => openDiscardReason('review')}
        />
        {discardReasonDialog}
      </>
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

  const recorderControls = (
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
      disabled={recordingBlocked}
      ended={phase === 'recorded'}
      recordingDuration={recordingDuration}
      frozenBars={frozenBars}
      endedActions={
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
      }
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
          // ⚖ 8/26 rider, ruled case (a): the refusal is known and the run
          // still has a take — the exact surface the field's dead loop passes
          // through (banner save → empty-transcript → キャンセル → re-offer).
          onDiscard={
            pipeline.error === 'empty-transcript' && pipeline.context?.takeId
              ? () => openDiscardReason('pipeline-error')
              : undefined
          }
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
          factsFailed={ticketsEnabled && factsFailed}
          onRetryFacts={() => setFactsAttempt((n) => n + 1)}
          onRepoint={() => setRepointOpen(true)}
          onSave={handleRecoverySaveTap}
          saving={recoverySaving}
          // Disabled while the day's truth is still in flight.
          saveDisabled={factsBlockSave}
          // ⚖ 8/26 rider, ruled case (b): below-floor TAKES only — a draft
          // always carries a transcript, so it never qualifies.
          // ponytail: the floor reads offerDurationSec — a store-timestamp
          // delta (~5s flush granularity, take-store.ts), not a measured
          // audio length. Accepted: it's the SAME number the receipt's
          // durationSeconds carries (below), so the UI gate and the below_floor
          // flag can never disagree — a late-landing chunk only ever loses the
          // exit (surface (a) still covers it), never fabricates one.
          belowFloor={offer.kind === 'take' && offerDurationSec < BELOW_FLOOR_SEC}
          onDiscard={
            offer.kind === 'take' && offerDurationSec < BELOW_FLOOR_SEC
              ? () => openDiscardReason('banner')
              : undefined
          }
        />
      )}

      {/* PR-B2 — the GREEN notice (mock B0a/B0b): the app finished the save
       *  itself, and this states what it did. Mutually exclusive with the amber
       *  banner by construction (a landed save clears the offer) and idle-only,
       *  the same visibility discipline the banner has. It renders only once a
       *  record provably exists — `recordId` is what proves it. */}
      {!offer && !live && autoNotice?.recordId && (
        <RecoveryAutoSavedNotice
          meta={autoNotice.meta}
          ticketState={autoNotice.ticketState}
          pack={autoNotice.pack}
          outcomeOwed={autoNotice.outcomeOwed}
          onOpenKarute={() =>
            router.push(
              `/karute/${autoNotice.recordId}` as Parameters<typeof router.push>[0],
            )
          }
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

      {/* 録音履歴 (Build F1, approved mock §1) — directly under the record
          controls in both layouts. Every session the signed-in staffer recorded
          in the last 7 days, with an honest state and at most one action. */}
      <RecordingsInboxCard
        rows={inbox.rows}
        needsAttention={inbox.needsAttention}
        serverFailed={inbox.serverFailed}
        now={inbox.foldedAt}
        locale={locale}
        customerNameById={customerNameById}
        onOpenRecord={handleInboxOpenRecord}
        onSaveTake={handleInboxSaveTake}
        myDiscardsThisMonth={myDiscardsThisMonth}
      />

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
          // `open` is deliberately a constant here — close is a same-commit
          // unmount (the `{outcomeFlow && ...}` guard above), not a toggle.
          // This mount must NOT be given the animated closing window without
          // also adding a resolve re-entry guard: its safety proof is
          // exactly the synchronous latch + instant unmount pairing.
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
                  // The B-8 filter above removed this binding's own
                  // appointment from `bookings`, so the row cannot find it
                  // there. A bound take's appointment IS a booking on the
                  // recording day (the re-point is day-restricted); a walk-in
                  // has no appointmentId and correctly keeps 当日の予約なし.
                  bookedToday: offerBinding.appointmentId != null,
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

      {/* P5-A: the written-reason gate — the LAST dialog on every deliberate
          discard, after the photos confirm above where that applies. */}
      {discardReasonDialog}
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
