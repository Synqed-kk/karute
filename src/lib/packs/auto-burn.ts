import type { Appointment, SynqedClient } from '@synqed-kk/client'
import { isTerminalStatus } from '@/lib/appointments/status'
import { orgSettingsWithClient, writeOrgSettingsBlobWithClient } from '@/actions/org-settings'
import { addRedemptionWithClient, listCustomerPacksWithClient } from '@/lib/packs/store'
import { pickRedemptionTarget } from '@/lib/packs/resolve'
import { ymdInJst } from '@/lib/date/jst'
import { audit } from '@/lib/audit'

// 自動消化 — the server-side burn for completed bookings (packet 11). The fix
// for the reconciliation freeze: while staff don't open the app, nothing burns.
//
// Completed-signal (prod-verified 7/12): this tenant's bookings carry only
// SCHEDULED / CANCELLED, so "past + not terminal = completed". isTerminalStatus
// covers CANCELLED **and** NO_SHOW, which is what makes cancel-neutrality
// (PRs #438-#440) structural here rather than a rule someone has to remember.
//
// THE TIMING CONTRACT (Liam's ruling 2026-08-08 — the burn FOLLOWS the session,
// it no longer waits for a nightly batch):
//   • a ticket burns ~2h after the booking ENDS, same day, if the booking is
//     not cancelled/no-show by then (GRACE_MS + the cutoff in
//     autoBurnForBusiness);
//   • the sweep runs HOURLY 09:00–23:00 JST (vercel.json `0 0-14 * * *`) so a
//     session that ends at 13:00 burns around 15:00, not tomorrow;
//   • 08:30 JST (`30 23 * * *`) stays as the SETTLE-UP pass, not the only pass:
//     it is what closes a late-evening session (ends 22:30 → its grace expires
//     after the 23:00 tick) and what finally advances the day marker.
// Why 2h: core's QR crawl ticks every 15 min inside 08:00–22:00 JST
// (sync.service isWithinBusinessHours, prod-seeded 8/22 Asia/Tokyo), so a
// last-minute cancellation gets ~8 passes to land before the money moves —
// which is the grace the old overnight comment only claimed to have (blind-round
// F1, ledger pre-autoburn-blind-round-ledger-2026-08-08.md).
//   RESIDUAL, documented not fixed here: a correction entered MORE than the
//   grace after the session ended can post-date a burn — the crawl's window
//   also starts at TODAY, so a post-close cancel of a same-evening booking
//   never reaches Karute at all. Closing both needs core to crawl 24/7 with a
//   −1 day lookback (Anthony asks, same ledger). Until they land, the cancel-
//   path warning (cancelAppointmentCore, appointments/mutations.ts) plus the
//   staff undo bound the exposure.
//   SECOND RESIDUAL of the hourly sweep, same ledger: an undo made DURING the
//   day is invisible to both guards and to the DB index (core soft-deletes the
//   row and exposes no removed-redemption read), so the next hourly pass can
//   re-charge it. Once the day is settled the marker below makes an undo stick,
//   exactly as before.
//
// Money rules, same discipline as the no-show burn (appointments/mutations.ts):
//   • fail CLOSED — an errored read SKIPS the burn and is REPORTED, never
//     treated as "never burned";
//   • one appointment burns ONE ticket EVER (guard 1, appointment_id);
//   • one customer-day burns ONE ticket EVER (guard 2 — NEW here: staff manual
//     burns don't always carry an appointment_id, so without it manual+auto
//     double-charge the same visit);
//   • reruns are idempotent, so a partially-failed run reruns safely — and the
//     hourly sweep IS a rerun: overlapping passes are covered by guard 1 plus
//     the DB's appointment-scoped unique index, never by the schedule;
//   • a SETTLED day is processed ONCE (the marker below) — an undo followed by
//     a rerun must not re-charge, and a soft-removed redemption is invisible to
//     both guards AND to the DB's partial unique index.

type AutoBurnClient = Pick<SynqedClient, 'appointments' | 'packs' | 'orgSettings'>

/** How many JST days BEFORE today a run may reach. Only days the marker hasn't
 *  cleared are actually processed, so this is the CATCH-UP depth for missed /
 *  failed runs; today is always in the window on top of it. */
const LOOKBACK_DAYS = 3

/** How long after a session ENDS a ticket may burn (Liam 2026-08-08). Not a
 *  tuning knob to shave: it is the room a last-minute cancellation has to reach
 *  Karute through core's 15-minute crawl before the money moves. */
const GRACE_MS = 2 * 60 * 60 * 1000

/** One core page. `total` decides when to stop, never this number. */
const PAGE_SIZE = 500

export interface AutoBurnSummary {
  businessId: string
  /** JST business date processed (yyyy-mm-dd). */
  date: string
  /** 'manual' / absent setting / unreadable settings → nothing was touched. */
  mode: 'auto' | 'manual' | 'unavailable'
  /** Completed bookings whose grace has expired — the ones this pass may burn. */
  candidates: number
  burned: number
  /** Completed, but still inside the 2h grace after the session ended. NOT a
   *  problem: a later pass burns them. Reported so an intraday run reads as
   *  "3 waiting" instead of the silence F7 taught us to distrust. */
  skippedTooSoon: number
  /** Guard 1 — this appointment already has a redemption. */
  skippedAlreadyBurned: number
  /** Guard 2 — this customer already has a redemption on this date. */
  skippedSameDay: number
  skippedNoPack: number
  /** Fail-closed skips: a read that errored, so we could not prove it safe. */
  skippedUnknown: number
  /** The DB below-zero trigger refused — surfaced, never silently swallowed. */
  belowZero: number
  errors: number
}

const empty = (
  businessId: string,
  date: string,
  mode: AutoBurnSummary['mode'],
): AutoBurnSummary => ({
  businessId,
  date,
  mode,
  candidates: 0,
  burned: 0,
  skippedTooSoon: 0,
  skippedAlreadyBurned: 0,
  skippedSameDay: 0,
  skippedNoPack: 0,
  skippedUnknown: 0,
  belowZero: 0,
  errors: 0,
})

/** Burn-history read floor for a whole day's candidates: a day before the
 *  EARLIEST anchor any of them has, where one booking's anchor is
 *  min(starts_at, created_at) — burnWindowSince's rule (mutations.ts), applied
 *  once so a single wide read serves every per-candidate check. starts_at is
 *  mutable (a reschedule moves it), created_at is not, so anchoring to
 *  whichever is earlier can only WIDEN the window; guard 1 matches exactly on
 *  appointment_id and guard 2 on an exact JST date, so wider catches MORE true
 *  burns and can never invent one. An unparseable row falls back to the day
 *  itself rather than poisoning the floor with NaN. */
function historySince(
  candidates: Array<{ starts_at: string; created_at?: string }>,
  date: string,
): string {
  const anchors = candidates
    .flatMap((a) => [Date.parse(a.starts_at), Date.parse(a.created_at ?? '')])
    .filter(Number.isFinite)
  const floor = anchors.length ? Math.min(...anchors) : Date.parse(`${date}T00:00:00+09:00`)
  return ymdInJst(new Date(floor - 86_400_000))
}

/** When the session ENDED, in ms. `ends_at` is core's own field on every
 *  booking (the reservation screens render it, adapters/reservation.ts);
 *  duration_minutes covers a row whose end never got written. Both unreadable
 *  → NaN, which FAILS the cutoff below — a booking we cannot time never burns. */
function sessionEndMs(a: Pick<Appointment, 'starts_at' | 'ends_at' | 'duration_minutes'>): number {
  const end = Date.parse(a.ends_at)
  if (Number.isFinite(end)) return end
  return Date.parse(a.starts_at) + (a.duration_minutes ?? 0) * 60_000
}

/** The scan window: the last `n` JST dates before today, plus TODAY, oldest
 *  first. Today is in scope because a burn now follows its own session by
 *  GRACE_MS instead of waiting for the day to be over; the earlier days are
 *  pure catch-up and their sessions all ended long ago. */
function recentJstDates(n: number): string[] {
  const now = Date.now()
  return Array.from({ length: n + 1 }, (_, i) => ymdInJst(new Date(now - (n - i) * 86_400_000)))
}

/**
 * The cron's per-business entry point: every JST day in the scan window the
 * marker hasn't cleared yet — always including TODAY — oldest first.
 *
 * The marker (`auto_burn_last_processed`, a date in the org-settings JSON blob
 * — the same zero-migration path pack_burn_mode itself takes) means "this JST
 * day is SETTLED". It is what makes an UNDO stick: a soft-removed redemption is
 * invisible to both guards and to the DB's partial unique index, so a second
 * run over a settled day would silently re-charge it. `force` (the cron route's
 * ?force=1, still CRON_SECRET-gated) is the deliberate backfill lever that
 * overrides it.
 */
export async function autoBurnRecentDays(
  synqed: AutoBurnClient,
  businessId: string,
  force = false,
): Promise<AutoBurnSummary[]> {
  const dates = recentJstDates(LOOKBACK_DAYS)
  const today = dates[dates.length - 1]
  const yesterday = dates[dates.length - 2]
  const marker = await orgSettingsWithClient(synqed)
    .then((s) => s?.auto_burn_last_processed)
    .catch(() => undefined)
  // NO marker = this business has never been processed: take ONLY today. A
  // first run (or the first run after the owner flips 自動消化 on) must never
  // retro-charge the days before that decision.
  const pending = force ? dates : marker ? dates.filter((d) => d > marker) : [today]
  // ...and that first run SEEDS the marker to yesterday. Today can never settle
  // itself (below), so without the seed "today only" would re-pick today on
  // every pass forever and every session whose grace expires after the last
  // intraday tick would be lost. Seeding claims nothing about yesterday's burns
  // — it records the no-retro-charge decision that `pending` just made.
  const seed = !force && !marker ? yesterday : undefined

  const summaries: AutoBurnSummary[] = []
  let high = marker ?? seed
  let stalled = false
  for (const date of pending) {
    const s = await autoBurnForBusiness(synqed, businessId, date)
    summaries.push(s)
    // High-water mark: only a day we could read END TO END counts as done. A
    // day that hit an unreadable settings row / appointment list / burn history
    // stays pending so tomorrow retries it — and no LATER day may carry the
    // mark past it.
    if (s.mode === 'unavailable' || s.errors > 0 || s.skippedUnknown > 0) stalled = true
    // Only a day that is OVER may be marked settled: today's sessions are still
    // ending, so an INTRADAY pass never advances the marker (its idempotency is
    // guards 1+2, never the marker). The 08:30 settle pass — or any pass on a
    // later JST day — is what finally closes the day and makes an undo stick.
    else if (!stalled && date < today) high = date
  }
  if (high && (!marker || high > marker)) await writeBurnMarker(synqed, businessId, high)
  return summaries
}

/** Move the marker. Fail-SAFE, unlike every read above: the burns have already
 *  landed, so a failed marker write is logged and swallowed — throwing here
 *  would report a run that actually succeeded as a failure. The cost of the
 *  miss is one repeated (guard-protected) day, never a lost burn. */
async function writeBurnMarker(
  synqed: AutoBurnClient,
  businessId: string,
  date: string,
): Promise<void> {
  const res = await writeOrgSettingsBlobWithClient(synqed, {
    auto_burn_last_processed: date,
  }).catch((err) => ({ error: err instanceof Error ? err.message : 'unknown' }))
  if ('error' in res) {
    console.warn('[auto-burn] marker write failed', JSON.stringify({ businessId, date }), res.error)
  }
}

/**
 * Burn one ticket per completed booking on `date` (JST) for ONE business.
 * No-ops entirely unless 回数券 are enabled AND `pack_burn_mode === 'auto'`.
 * Never throws: every failure lands in the summary so the cron response and the
 * weekly sheet-sync lane can both read what actually happened.
 */
export async function autoBurnForBusiness(
  synqed: AutoBurnClient,
  businessId: string,
  date: string,
): Promise<AutoBurnSummary> {
  // Settings read fails → 'unavailable', NOT a burn. A business whose mode we
  // cannot read is a business we must not charge.
  const settings = await orgSettingsWithClient(synqed).catch(() => undefined)
  if (settings === undefined) return empty(businessId, date, 'unavailable')
  // The 回数券 master switch outranks the burn mode (blind-round F3): settings
  // writes MERGE, so pack_burn_mode:'auto' survives in the blob after an owner
  // turns 回数券 off — without this gate the cron would keep charging against a
  // feature whose every surface is hidden.
  if (settings?.ticket_packs_enabled === false) return empty(businessId, date, 'manual')
  if (settings?.pack_burn_mode !== 'auto') return empty(businessId, date, 'manual')

  const s = empty(businessId, date, 'auto')

  // Paginate to exhaustion (blind-round F7): one page-of-500 silently dropped
  // every booking past the 500th on a busy day — a truncated read reads as
  // "nothing to burn", the quietest possible money bug.
  const appointments: Appointment[] = []
  try {
    // ponytail: hard page cap. 40 × 500 is ~20k bookings in ONE day — a core
    // that still reports more is broken, and a money cron must stop rather
    // than spin. Raise it the day a tenant legitimately gets near it.
    for (let page = 1; page <= 40; page += 1) {
      const res = await synqed.appointments.list({
        from: new Date(`${date}T00:00:00+09:00`).toISOString(),
        to: new Date(`${date}T23:59:59.999+09:00`).toISOString(),
        page,
        page_size: PAGE_SIZE,
      })
      appointments.push(...res.appointments)
      // An empty page also stops the loop: a wrong/absent `total` must not
      // spin a money cron forever.
      if (res.appointments.length === 0 || appointments.length >= res.total) break
    }
  } catch {
    s.errors += 1
    return s
  }

  // CANCELLED and NO_SHOW never reach the burn — cancel-neutrality is enforced
  // by construction, not by a downstream check that could be edited away.
  const completed = appointments.filter((a) => !isTerminalStatus(a.status) && a.customer_id)
  // THE GRACE (Liam 2026-08-08): a session that ended less than GRACE_MS ago is
  // not burnable YET — the crawl still has passes left to deliver a late
  // cancellation, and a cancellation that lands inside the grace turns the
  // booking terminal, so it never reaches this line again. The next hourly pass
  // picks the leftovers up; on a past day every session cleared this cutoff
  // long ago, so it only ever bites on today. Deliberately NOT a stall signal
  // for the marker: waiting is normal, and a booking whose end is unreadable or
  // absurd would otherwise wedge the marker on that day forever. Fail-closed —
  // it stays unburned and stays visible in the summary.
  const cutoff = Date.now() - GRACE_MS
  const candidates = completed.filter((a) => sessionEndMs(a) <= cutoff)
  s.skippedTooSoon = completed.length - candidates.length
  s.candidates = candidates.length
  if (candidates.length === 0) return s

  // ONE history read serves both guards. Tri-state: an errored read fails
  // CLOSED for the WHOLE day — we cannot prove any of these safe.
  const history = await synqed.packs
    .listRecentRedemptions(historySince(candidates, date))
    .then((rows) => rows.map((r) => ({ appointment_id: r.appointment_id, customer_id: r.customer_id, redeemed_on: r.redeemed_on.slice(0, 10) })))
    .catch(() => 'unknown' as const)
  if (history === 'unknown') {
    s.skippedUnknown = candidates.length
    return s
  }

  for (const appt of candidates) {
    const on = ymdInJst(new Date(appt.starts_at))
    if (history.some((r) => r.appointment_id === appt.id)) {
      s.skippedAlreadyBurned += 1
      continue
    }
    // Guard 2 also closes the same-run window: two bookings for one customer on
    // one day must still burn ONE ticket, so burns made in this loop are pushed
    // back into `history` below before the next iteration reads it.
    if (history.some((r) => r.customer_id === appt.customer_id && r.redeemed_on === on)) {
      s.skippedSameDay += 1
      continue
    }

    const packs = await listCustomerPacksWithClient(synqed, appt.customer_id).catch(
      () => 'unknown' as const,
    )
    if (packs === 'unknown') {
      // Distinct from skippedNoPack on purpose: "we could not read" and "this
      // customer has nothing to burn" are different facts on a money report.
      s.skippedUnknown += 1
      continue
    }
    // サブスク/単発 and exhausted packs are excluded by pickRedemptionTarget
    // (kind==='pack' && status==='active' && remaining>0) — a no-op, never an
    // error, never a negative balance.
    const target = pickRedemptionTarget(packs)
    if (!target) {
      s.skippedNoPack += 1
      continue
    }

    const burn = await burnOneAutoRedemption(synqed, businessId, {
      appointmentId: appt.id,
      customerId: appt.customer_id,
      packId: target.id,
      on,
    })
    if ('ok' in burn) {
      s.burned += 1
      history.push({ appointment_id: appt.id, customer_id: appt.customer_id, redeemed_on: on })
    } else if (burn.error === 'below_zero') {
      s.belowZero += 1
    } else if (burn.error === 'already_burned') {
      // The DB's partial unique index refused a SECOND live redemption for
      // this appointment — guard 1's outcome reached a hair late (a stale
      // history read, a concurrent write). Idempotent, not a failure.
      s.skippedAlreadyBurned += 1
    } else {
      s.errors += 1
    }
  }

  return s
}

/**
 * ONE auto burn and its audit row — the audited money write, split out from the
 * batch driver above so the emit DOMINATES every success return (CP2's
 * coveredBy proof). The driver legitimately returns without emitting when there
 * is nothing to burn, which is not something a per-mutation writer contract can
 * express; this is.
 */
export async function burnOneAutoRedemption(
  synqed: Pick<SynqedClient, 'packs'>,
  businessId: string,
  b: { appointmentId: string; customerId: string; packId: string; on: string },
): Promise<{ ok: true } | { error: 'below_zero' | 'already_burned' | 'burn_failed' }> {
  const burn = await addRedemptionWithClient(synqed, {
    packId: b.packId,
    customerId: b.customerId,
    redeemedOn: b.on,
    appointmentId: b.appointmentId,
    // 'auto' makes these burns distinguishable and reversible in an audit —
    // core persists `source` verbatim (packs.service.ts addRedemption).
    source: 'auto',
    // Unlike a no-show: a completed visit IS a visit.
    countsAsVisit: true,
  })
  if (!burn.ok) {
    if (burn.error === 'below_zero') return { error: 'below_zero' }
    // The appointment-scoped unique index (blind-round F6): a duplicate is the
    // guard working, so it must not be reported as a generic error.
    if (burn.error === 'already_redeemed') return { error: 'already_burned' }
    return { error: 'burn_failed' }
  }

  // A ticket moved with no staff touching anything — 'notice', actor 'system',
  // so an auto burn is as disputable after the fact as a staff one.
  // no-request-scope: a Vercel cron tick has no inbound request id to thread —
  // the appointment_id + redemption_id in detail are the correlation keys.
  audit({
    category: 'customer',
    action: 'customer.pack_redeem',
    actorId: null,
    actorType: 'system',
    businessId,
    targetType: 'customer',
    targetId: b.customerId,
    severity: 'notice',
    detail: {
      appointment_id: b.appointmentId,
      pack_id: b.packId,
      redemption_id: burn.id,
      redeemed_on: b.on,
      source: 'auto',
    },
    source: 'system',
  })
  return { ok: true }
}
