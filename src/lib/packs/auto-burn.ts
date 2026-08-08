import type { SynqedClient } from '@synqed-kk/client'
import { isTerminalStatus } from '@/lib/appointments/status'
import { orgSettingsWithClient } from '@/actions/org-settings'
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
// The grace window IS the schedule: the cron runs 06:00 JST over YESTERDAY, so
// core's 15-min crawl has had all night to land a late cancellation and a
// cancel can never lose the race against a burn.
//
// Money rules, same discipline as the no-show burn (appointments/mutations.ts):
//   • fail CLOSED — an errored read SKIPS the burn and is REPORTED, never
//     treated as "never burned";
//   • one appointment burns ONE ticket EVER (guard 1, appointment_id);
//   • one customer-day burns ONE ticket EVER (guard 2 — NEW here: staff manual
//     burns don't always carry an appointment_id, so without it manual+auto
//     double-charge the same visit);
//   • reruns are idempotent, so a partially-failed run reruns safely.

type AutoBurnClient = Pick<SynqedClient, 'appointments' | 'packs' | 'orgSettings'>

export interface AutoBurnSummary {
  businessId: string
  /** JST business date processed (yyyy-mm-dd). */
  date: string
  /** 'manual' / absent setting / unreadable settings → nothing was touched. */
  mode: 'auto' | 'manual' | 'unavailable'
  candidates: number
  burned: number
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
  skippedAlreadyBurned: 0,
  skippedSameDay: 0,
  skippedNoPack: 0,
  skippedUnknown: 0,
  belowZero: 0,
  errors: 0,
})

/** JST business date one day before `date` — the burn-history read window,
 *  matching the no-show guard's "a day before the anchor" rule. */
function dayBefore(date: string): string {
  return ymdInJst(new Date(new Date(`${date}T00:00:00+09:00`).getTime() - 86_400_000))
}

/**
 * Burn one ticket per completed booking on `date` (JST) for ONE business.
 * No-ops entirely unless `pack_burn_mode === 'auto'`. Never throws: every
 * failure lands in the summary so the cron response and the weekly sheet-sync
 * lane can both read what actually happened.
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
  if (settings?.pack_burn_mode !== 'auto') return empty(businessId, date, 'manual')

  const s = empty(businessId, date, 'auto')

  let appointments
  try {
    ;({ appointments } = await synqed.appointments.list({
      from: new Date(`${date}T00:00:00+09:00`).toISOString(),
      to: new Date(`${date}T23:59:59.999+09:00`).toISOString(),
      page_size: 500,
    }))
  } catch {
    s.errors += 1
    return s
  }

  // CANCELLED and NO_SHOW never reach the burn — cancel-neutrality is enforced
  // by construction, not by a downstream check that could be edited away.
  const candidates = appointments.filter((a) => !isTerminalStatus(a.status) && a.customer_id)
  s.candidates = candidates.length
  if (candidates.length === 0) return s

  // ONE history read serves both guards. Tri-state: an errored read fails
  // CLOSED for the WHOLE day — we cannot prove any of these safe.
  const history = await synqed.packs
    .listRecentRedemptions(dayBefore(date))
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
): Promise<{ ok: true } | { error: 'below_zero' | 'burn_failed' }> {
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
  if (!burn.ok) return { error: burn.error === 'below_zero' ? 'below_zero' : 'burn_failed' }

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
