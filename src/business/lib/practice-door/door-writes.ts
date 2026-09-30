// PKT-S29-B1 — the Business write door for 臨時休業 (StoreClosedDay) +
// 特別営業日 (special_open_days), per store, in 設定 store-hours. ONE file
// calls the three core writes this door owns: `storePolicies.set` (used by
// `setSpecialOpenDays`), `storePolicies.addClosedDay` and
// `storePolicies.removeClosedDay` — core-reach.ts hands over only the bound
// client handle (`storeDaysWriterFor`), it never calls them itself.
//
// FENCE ROWS — the business-territory.json "writers" rows for the three
// store-policy call sites landed in their own non-Business PR (#1091, merged);
// the fourth write, the closure-removal `audit.log`, has its row on main too
// (#1092, merged). With those rows present CP3
// (check-business-data-access.mjs + audit-sdk-write-sites.test.ts) is green.
//
// Same guard order as door.ts:494-524's `writeReserveCardColor` (quoted in
// EV/CENSUS-B1-S29.md §1a): OFF check → lazy `import('./core-reach')` →
// admission/actor resolution → capability → (write-only) read-before-write →
// the one SDK call → refusal mapping in the outer catch. `readStoreDays`
// skips the capability step (R8: a read-only actor still sees the lists).

// ⚠ NO import of '@synqed-kk/client' anywhere in this file, bare or `import
// type` — data.ts is this file's ONLY importer (the shared-cores door's own
// isolation pin, business-isolation.test.ts), settings-props.ts reaches its
// pure copy constants + `specialDayBadge` THROUGH data.ts, never directly, and
// even a type-only import of the bare package is refused by the business
// play-phase fence (check-business-data-access.mjs, "flagged DELIBERATELY").
// Every type below is derived from `CoreReads`/`CoreClient` instead (same
// trick practice-door-recorded.ts uses), and `SynqedError` is recognised by
// shape (`isSynqedError`) rather than `instanceof` — no import needed either way.
import { practiceActor, visibleIds, type PracticeActor } from './actor'
import { practiceTenant } from './switch'
import { canManageSettings } from './door'
import { jstYmd, renderNow } from '../clock'
import type { CoreReads } from './core-reach'
import { applySpecialOpenDays, DUPLICATE_SPECIAL_LINE, GENERIC_FAIL_LINE, OPEN_NOT_BEFORE_CLOSE_LINE, PICK_DATE_LINE, PICK_TIME_LINE, READ_ONLY_NOTE, specialDayBadge } from '../store-days-state'

// ── shared result shapes ─────────────────────────────────────────────────────

type StorePolicy = Awaited<ReturnType<CoreReads['storePolicyGet']>>
export type SpecialOpenDay = StorePolicy['special_open_days'][number]
type ClosedDaysRead = Awaited<ReturnType<CoreReads['storePolicyListClosedDays']>>
export type StoreClosedDay = ClosedDaysRead['closed_days'][number]

/** ⚖ PKT-S30 P3-10 — each list honest on its own: `null` = THAT list's read failed (R7), the other
 *  list still arrives. Both failing is a refusal, as before. */
export interface StoreDaysRead {
  closures: StoreClosedDay[] | null
  specialOpenDays: SpecialOpenDay[] | null
}
type Reason = 'forbidden' | 'tenant' | 'invalid' | 'core'
type Refusal = { ok: false; reason: Reason; message: string }
export type StoreDaysReadResult = ({ ok: true } & StoreDaysRead) | Refusal
export type AddClosedDayResult = { ok: true; row: StoreClosedDay } | Refusal
export type RemoveClosedDayResult = { ok: true; closures: StoreClosedDay[] } | Refusal
export type SetSpecialOpenDaysResult = { ok: true; specialOpenDays: SpecialOpenDay[] } | Refusal

// ── R9 copy (Opus author + Sonnet blind pass, EV/copy/) ─────────────────────
// 「変更には本部の権限が必要です。」and「臨時休業より優先」are the folded verdicts —
// both replace an earlier draft (this door's own README history, EV/copy/);
// every other line here is either a ⚖ ruled string (past-date, both
// duplicates) or the copy round's KEPT draft.
const MSG = {
  invalidDate: '存在しない日付です',
  pastDate: '過ぎた日付です',
  openNotBeforeClose: OPEN_NOT_BEFORE_CLOSE_LINE,
  duplicateSpecial: DUPLICATE_SPECIAL_LINE,
  duplicateClosure: 'その日はすでに臨時休業です',
  readOnly: READ_ONLY_NOTE,
  // ⚖ PKT-S30 P3-5 — the section's own empty-date line (settings-props.ts emptyDateError), and
  // the same shape for an empty time (no sibling time line exists).
  pickDate: PICK_DATE_LINE,
  pickTime: PICK_TIME_LINE,
  // ⚖ PKT-S30 P3-3 — core's own cap (specialOpenDaysSchema.max(366), CORE-READ-B1.md:171), counted
  // on core's WHOLE array (past entries included): a validation refusal, never "try later".
  specialCap: '特別営業日は366件までのため、これ以上追加できません。',
  genericFail: GENERIC_FAIL_LINE,
  readFailure: 'いまは予定を読み込めないため、時間をおいてページを再読み込みしてください。',
} as const
/** 特別営業日 block note (R8) + the read-failure line, reached by settings-props.ts through data.ts.
 *  ⚖ PKT-S30 P3-12 — the badge, the read-only line and the pending labels live in
 *  store-days-state.ts (the copy the client screen prints too); this file imports them. */
export const SPECIAL_OPEN_DAYS_NOTE = '通常の営業時間とは別に営業する、その日限りの予定です。'
export const READ_FAILURE_LINE = MSG.readFailure

// ── R2 — capability, honest ──────────────────────────────────────────────────

/** ⚖ R2(c) (lead's fold — the SDK exposes the grants check, so this branch is
 *  the only one that applies; the packet's "no such method" branch is
 *  deleted): an OWNER always passes core's own `requireHqAdmin`; anyone else
 *  needs a LIVE HQ_ADMIN grant. ONE call per actor (memoized on the actor's own
 *  bound reads, like door.ts's `orgSettingsOf`'s `ORG_ONCE`) — P-B1-4 pins that
 *  a second write attempt by the same actor never asks core the grant
 *  question twice. */
// ⚖ PKT-S30 F12 — memoized in THIS module, keyed by business_id + staff_id (one entry per
// admitted actor, so it never grows past the actors of one process). Only a live grant is kept:
// a refusal (not granted) or a failed check clears the entry, so the next write asks core again.
// A grant revoked after it was cached still meets core's own requireHqAdmin on the write (403 →
// `forbidden`, read-only line) — the memo can never widen what core allows.
// A keyed record rather than a Map: the door scan (foundation.test.ts) forbids every `.set(` /
// `.delete(` / `.create(` token in practice-door/ outside the named writer lines; a record with
// `delete` behaves the same. Keys always contain ':', so no key can meet an Object.prototype name.
const HQ_GRANTED: Record<string, Promise<boolean>> = {}
const grantKey = (actor: PracticeActor): string => `${actor.businessId}:${actor.sheet.staff_id}`
async function isHqAdmin(actor: PracticeActor): Promise<boolean> {
  if (actor.sheet.coarse_role === 'OWNER') return true
  const key = grantKey(actor)
  const check = (HQ_GRANTED[key] ??= actor.reads.businessGrantsCheck(actor.card.id).then((r) => r.granted))
  try {
    const granted = await check
    if (!granted) delete HQ_GRANTED[key]
    return granted
  } catch (e) {
    delete HQ_GRANTED[key]
    throw e
  }
}
/** Drops every memoized grant (tests; a process that must forget grants). */
export function forgetStoreDaysGrants(): void {
  for (const key of Object.keys(HQ_GRANTED)) delete HQ_GRANTED[key]
}

/** ⚖ R2 — may this actor write EITHER list for this store?
 *  (a) store isolation — `visibleIds(actor)`, the SAME list `writeBookingColors`
 *  (door-booking-colors.ts) gates a store writer on. ⚠ DIVERGENCE FROM THE
 *  PACKET, FLAGGED FOR THE LEAD'S LINE-AUDIT: R2(a)'s literal text is
 *  `sheet.visible_store_ids === null || sheet.visible_store_ids.includes(storeId)`
 *  — read literally, that treats a null `visible_store_ids` as "every store"
 *  for EVERY actor, which contradicts the store-isolation law actor.ts already
 *  encodes (FOLD F-2, ⚖ 9/16: "core's null = 'every store' only WITH
 *  stores.viewAll; without it, nothing" — actor.ts:76-77). This function uses
 *  the audited `visibleIds(actor)` helper instead of re-deriving from the raw
 *  sheet field, so a non-viewAll actor with a null sheet sees zero stores here,
 *  matching every other store-scoped writer in this door (door-booking-colors.ts)
 *  rather than the packet's literal formula.
 *  (b) `settings.manage` — the section's own gate (`canManageSettings`, door.ts).
 *  (c) core's actual write guard, `requireHqAdmin`: OWNER by role, else a live
 *  HQ_ADMIN grant (`isHqAdmin` above). */
/** ⚖ PKT-S31 R9 — tri-state end to end: 'unknown' = core did not answer the actor or grant question
 *  (never read as a refusal); 'read-only' = core answered and this actor may not write. */
export type StoreDaysWriteState = 'writable' | 'read-only' | 'unknown'
export async function canWriteStoreDays(storeId: string): Promise<StoreDaysWriteState> {
  // ⚖ PKT-S30 F8 — the card-colour sibling's shape (door.ts readCanManageCardColor): an actor or
  // grant-check outage = cannot verify → 'unknown', logged; never a crash of 設定.
  try {
    const actor = await practiceActor()
    return (await canWriteStoreDaysFor(actor, storeId)) ? 'writable' : 'read-only'
  } catch (e) {
    console.error('[business store days] core did not answer:', e instanceof Error ? e.message : String(e))
    return 'unknown'
  }
}
async function canWriteStoreDaysFor(actor: PracticeActor, storeId: string): Promise<boolean> {
  if (!visibleIds(actor).includes(storeId)) return false
  if (!canManageSettings(actor)) return false
  return isHqAdmin(actor)
}

// ── R3 — validation, before any core call ────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// core's own two regexes, restated here (EV/CORE-READ-B1.md Q3,
// store-policies.ts:10-11) rather than imported: this door does not import
// core, and two literal regexes are cheaper than a cross-repo dependency for
// a fixed, documented contract.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const CLOSE_TIME_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/
const MAX_SPECIAL_DAYS = 366 // core's own cap (specialOpenDaysSchema.max(366))

function isRealCalendarDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false
  const d = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
}

/** Today's JST calendar date as YYYY-MM-DD — the door's own clock (`renderNow`
 *  / `jstYmd`), never the wall clock, so a pinned test clock moves this too. */
function todayJst(): string {
  const { y, m, d } = jstYmd(renderNow())
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Zero-padded YYYY-MM-DD strings compare lexicographically exactly like
 *  calendar order — today itself is allowed (R3: "today itself is allowed"). */
function isPastDate(date: string): boolean {
  return date < todayJst()
}

function validateDate(date: string): string | null {
  if (date === '') return MSG.pickDate
  if (!isRealCalendarDate(date)) return MSG.invalidDate
  if (isPastDate(date)) return MSG.pastDate
  return null
}

/** Open/close shape + ordering — the door's own bound (R3), before any core
 *  call. The section's add form uses the WeekTable's own `<input type=time>`,
 *  which never emits a malformed string in normal use; a shape failure here
 *  can only reach the door through a bypassed control, and folds into the
 *  same "fix the times" refusal rather than a second, rarer message. */
function validateSpecialTimes(open: string, close: string): string | null {
  if (open === '' || close === '') return MSG.pickTime
  if (!TIME_RE.test(open)) return MSG.openNotBeforeClose
  if (!CLOSE_TIME_RE.test(close)) return MSG.openNotBeforeClose
  if (!(open < close)) return MSG.openNotBeforeClose
  return null
}

// ── R4 — core refusals that pass the door, mapped ONE table ─────────────────

/** Recognised by SHAPE, never `instanceof` — this file imports no SDK class
 *  (see the file header): the SDK's own `SynqedError` sets `name` in its
 *  constructor and always carries a numeric `status` + string `message`
 *  (`Error`'s own field), which is enough to tell it apart from a plain throw. */
function isSynqedError(e: unknown): e is { name: string; status: number; message: string } {
  return e instanceof Error && e.name === 'SynqedError' && typeof (e as { status?: unknown }).status === 'number'
}

/** ⚖ PKT-S31 R1 — core's own 403 on ANY of the three writes means the grant is gone: the actor's memo
 *  entry is cleared BEFORE the refusal is mapped, so the next render asks core again (no TTL). */
function writeFailed(e: unknown, { actor, reach }: Admitted): Refusal {
  if (isSynqedError(e) && e.status === 403) delete HQ_GRANTED[grantKey(actor)]
  return mapCoreError(e, reach)
}

/** Core's own words for a duplicate special date — the message is the truth (its status is UNVERIFIED).
 *  ONE exact-equality comparison, shared by mapCoreError and the special-days set (PKT-S32 R15). */
function isDuplicateSpecial(e: { message: string }): boolean {
  return e.message === 'Special open dates must be unique'
}

function mapCoreError(e: unknown, reach: typeof import('./core-reach')): Refusal {
  if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant', message: MSG.genericFail }
  if (isSynqedError(e)) {
    if (e.status === 403) return { ok: false, reason: 'forbidden', message: MSG.readOnly }
    if (e.message === 'This date is already a closed day for the store.') {
      return { ok: false, reason: 'invalid', message: MSG.duplicateClosure }
    }
    if (isDuplicateSpecial(e)) return { ok: false, reason: 'invalid', message: MSG.duplicateSpecial }
    if (e.message === 'open must be before close') return { ok: false, reason: 'invalid', message: MSG.openNotBeforeClose }
    if (e.message === 'date is not a real calendar date') return { ok: false, reason: 'invalid', message: MSG.invalidDate }
    // English never reaches the screen (R4) — logged for whoever reads the server console.
    console.warn('[business store days] core refused:', e.status, e.message)
    return { ok: false, reason: 'core', message: MSG.genericFail }
  }
  console.error('[business store days] core did not save:', e instanceof Error ? e.message : String(e))
  return { ok: false, reason: 'core', message: MSG.genericFail }
}

// ── admission (shared by all four exports) ──────────────────────────────────

interface Admitted {
  ok: true
  actor: PracticeActor
  reach: typeof import('./core-reach')
}
export const TENANT_REFUSAL: Refusal = { ok: false, reason: 'tenant', message: MSG.genericFail }
const FORBIDDEN: Refusal = { ok: false, reason: 'forbidden', message: MSG.readOnly }
const invalid = (message: string): Refusal => ({ ok: false, reason: 'invalid', message })

async function admitActor(): Promise<Admitted | Refusal> {
  if (practiceTenant() === null) return TENANT_REFUSAL
  const reach = await import('./core-reach') // lazy, like door.ts: the OFF path never loads the SDK
  let actor: PracticeActor
  try {
    actor = await practiceActor()
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return TENANT_REFUSAL
    console.error('[business store days] core did not answer:', e instanceof Error ? e.message : String(e))
    return { ok: false, reason: 'core', message: MSG.genericFail }
  }
  return { ok: true, actor, reach }
}

/** ⚖ PKT-S30 F7 / P3-1 — ONE admission per public write: actor → capability (isolation, settings.manage,
 *  HQ grant). The pure validation already ran before this (door.ts:494-524's order: OFF → validation →
 *  lazy import → actor → capability → read-before-write → the one SDK call). */
async function admitWriter(storeId: string): Promise<Admitted | Refusal> {
  const admitted = await admitActor()
  if (!admitted.ok) return admitted
  // ⚖ PKT-S30 F8 — the capability check sits INSIDE the try: a thrown grant check is core's
  // failure (`core` → 503 honesty), never a `forbidden`.
  try {
    if (!(await canWriteStoreDaysFor(admitted.actor, storeId))) return FORBIDDEN
  } catch (e) {
    return mapCoreError(e, admitted.reach)
  }
  return admitted
}

/** ⚖ PKT-S30 P3-4 — 特別営業日 are LISTED from today (store JST day), like closures; past entries
 *  stay in core's array untouched and ride back unchanged in every `set`. */
const fromToday = (days: SpecialOpenDay[]): SpecialOpenDay[] => days.filter((d) => !isPastDate(d.date))
const byDate = <T extends { date: string }>(a: T, b: T): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
// Core's StoreClosedDay ids are uuids (P3-8): anything else is refused before any call.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── R1/R5/R7 — readStoreDays ─────────────────────────────────────────────────

/** LIVE: one store's 臨時休業 + 特別営業日, fresh every call (never memoized
 *  across writes — R1). Store isolation only (R2(a)) — a read-only actor
 *  still sees the lists (R8); `settings.manage`/HQ gate the WRITES, not the
 *  read. A failed read is an error state (R7): the caller must never render
 *  `[]` for either list on a `{ok:false}` answer. */
export async function readStoreDays(storeId: string): Promise<StoreDaysReadResult> {
  const admitted = await admitActor()
  if (!admitted.ok) return admitted
  const { actor, reach } = admitted
  if (!visibleIds(actor).includes(storeId)) return FORBIDDEN
  const [policy, closedDays] = await Promise.allSettled([
    actor.reads.storePolicyGet(storeId),
    actor.reads.storePolicyListClosedDays(storeId, { from: todayJst() }),
  ])
  if (policy.status === 'rejected' && closedDays.status === 'rejected') return mapCoreError(policy.reason, reach)
  // One failed list: logged through the same mapping (warn/error), and that list alone reads as failed.
  if (policy.status === 'rejected') mapCoreError(policy.reason, reach)
  if (closedDays.status === 'rejected') mapCoreError(closedDays.reason, reach)
  return {
    ok: true,
    closures: closedDays.status === 'fulfilled' ? closedDays.value.closed_days : null,
    specialOpenDays: policy.status === 'fulfilled' ? fromToday(policy.value.special_open_days) : null,
  }
}

// ── R6 — closures: addClosedDay / removeClosedDay ───────────────────────────

// internal safety bound on the audit write that must land before core's hard delete — not a store setting
const AUDIT_LOG_BOUND_MS = 5000

/** null = the audit call answered in time; otherwise why it did not (rejection, sync throw, timeout). */
async function withinAuditBound(work: Promise<void>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const bound = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`no answer within ${AUDIT_LOG_BOUND_MS} ms`), AUDIT_LOG_BOUND_MS)
  })
  try {
    return await Promise.race([work.then(() => null, (e: unknown) => (e instanceof Error ? e.message : String(e))), bound])
  } finally {
    clearTimeout(timer)
  }
}

export async function addClosedDay(storeId: string, input: { date: string; reason: string }): Promise<AddClosedDayResult> {
  if (practiceTenant() === null) return TENANT_REFUSAL
  // ⚖ PKT-S31 R6 — trim first, then '' → null (a spaces-only reason is no reason).
  const reason = input.reason.trim()
  const dateProblem = validateDate(input.date)
  if (dateProblem) return invalid(dateProblem)
  const admitted = await admitWriter(storeId)
  if (!admitted.ok) return admitted
  const { actor, reach } = admitted
  try {
    // R3 — a fresh read decides "already a closure" before core is ever asked
    // (never memoized: a second add in the same render re-reads).
    const { closed_days: before } = await actor.reads.storePolicyListClosedDays(storeId, { from: todayJst() })
    if (before.some((c) => c.date === input.date)) return invalid(MSG.duplicateClosure)
    // Also-noted B — the store's JST day may have turned since validation: re-checked at write time.
    if (isPastDate(input.date)) return invalid(MSG.pastDate)
    const writer = reach.storeDaysWriterFor({ businessId: actor.businessId })
    // ⚖ lead's fold #2 — AuditEventInput requires actor_type + category + action;
    // core's own store_policy.edit row is a DIFFERENT write (setPolicy only) —
    // this is the closure add's own event, opted into via the SDK's `audit` field
    // (AddClosedDayInput.audit is a full AuditEventInput, so it carries `detail`).
    // ⚖ PKT-S30 F11 — which day, which store, why: store_id + target_label (the date) +
    // detail { date, reason } (reason '' when none, never omitted).
    const addEvent = { actor_type: 'staff' as const, actor_id: actor.sheet.staff_id, category: 'settings', action: 'store_closed_day.add', target_type: 'store_closed_day', store_id: storeId, target_label: input.date, detail: { date: input.date, reason } }
    const row = await writer.storePolicies.addClosedDay(storeId, { date: input.date, reason: reason === '' ? null : reason, acting_staff_id: actor.sheet.staff_id, audit: addEvent })
    console.info(
      '[business store days]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, action: 'closure.add', date: row.date, at: renderNow().toISOString() }),
    )
    return { ok: true, row }
  } catch (e) {
    return writeFailed(e, admitted)
  }
}

/** ⚖ lead's fold #2 — core's SDK `removeClosedDay(storeId, id, actingStaffId)`
 *  takes NO audit payload and HARD-DELETES the row (`tx.storeClosedDay.delete`,
 *  EV/CORE-READ-B1.md Q2) — a genuine exception to the standing "nothing
 *  deleted, soft only" rule, flagged in the PR body as a core ask, not fixed
 *  here. The door records its own audit event for the removal through the
 *  write-only `{ audit: { log } }` handle.
 *  ⚖ PKT-S32 R19/R21 — a `remove_attempt` row is written BEFORE core's hard
 *  delete (no row → no removal: refused, nothing deleted); the `remove` row is
 *  written only AFTER a successful delete (best-effort), so a `remove` row
 *  always means a completed removal.
 *  ⚖ PKT-S30 F9 — the fresh read (no from-date filter) already lacks the id →
 *  another admin removed it: ok, no core call, the list refreshed from that read.
 *  P3-9 — a closure dated before today is a record: refused, no write — no
 *  audit row either (⚖ PKT-S32 R19: rows are written only for a removal that is attempted). */
export async function removeClosedDay(storeId: string, id: string): Promise<RemoveClosedDayResult> {
  if (practiceTenant() === null) return TENANT_REFUSAL
  if (typeof id !== 'string' || !UUID_RE.test(id)) return invalid(MSG.genericFail)
  const admitted = await admitWriter(storeId)
  if (!admitted.ok) return admitted
  const { actor, reach } = admitted
  try {
    const { closed_days: all } = await actor.reads.storePolicyListClosedDays(storeId)
    const upcoming = (rows: StoreClosedDay[]) => rows.filter((c) => !isPastDate(c.date))
    const row = all.find((c) => c.id === id)
    if (!row) return { ok: true, closures: upcoming(all) }
    if (isPastDate(row.date)) return invalid(MSG.pastDate)
    const writer = reach.storeDaysWriterFor({ businessId: actor.businessId })
    const reason = row.reason ?? ''
    // ⚖ PKT-S31 R2 (bound + warn shape kept) · ⚖ PKT-S32 R19/R21 — two rows, ONE audit.log call site, directly
    // in this function (the allowlisted symbol), each raced against AUDIT_LOG_BOUND_MS:
    //   1. store_closed_day.remove_attempt BEFORE core's hard delete — blocking: a sync throw, a rejection or
    //      no answer in time REFUSES the removal and the delete is never called (no row, no removal);
    //   2. store_closed_day.remove only AFTER a successful delete — best-effort: a failure is warned and the
    //      completed removal still answers ok. A `remove` row always means a completed removal.
    // A delete that throws writes no further row: the attempt row + the closure still in core is the truth.
    for (const action of ['store_closed_day.remove_attempt', 'store_closed_day.remove'] as const) {
      const auditProblem = await withinAuditBound(
        (async () => {
          const auditHandle = reach.auditWriterFor({ businessId: actor.businessId })
          await auditHandle.audit.log({
            actor_type: 'staff',
            actor_id: actor.sheet.staff_id,
            category: 'settings',
            action,
            target_type: 'store_closed_day',
            target_id: row.id,
            store_id: storeId,
            target_label: row.date,
            detail: { date: row.date, reason },
          })
        })(),
      )
      if (action === 'store_closed_day.remove') {
        if (auditProblem !== null) {
          console.warn(
            '[business store days] removal completed; its completion row was not written (the attempt row stands):',
            JSON.stringify({ store_id: storeId, target_id: row.id, date: row.date, reason, problem: auditProblem }),
          )
        }
        break
      }
      if (auditProblem !== null) {
        // ⚖ PKT-S30 F11 · ⚖ PKT-S32 R19 — warn, never console.error: nothing was removed.
        console.warn(
          '[business store days] audit record refused the removal (nothing removed):',
          JSON.stringify({ store_id: storeId, target_id: row.id, date: row.date, reason, problem: auditProblem }),
        )
        return { ok: false, reason: 'core', message: MSG.genericFail }
      }
      // ⚖ PKT-S32 R20 — re-checked after the audit wait (up to AUDIT_LOG_BOUND_MS): a closure that became a record meanwhile is never deleted; the attempt row stands as the attempt.
      if (isPastDate(row.date)) return invalid(MSG.pastDate)
      try {
        await writer.storePolicies.removeClosedDay(storeId, id, actor.sheet.staff_id)
      } catch (e) {
        return writeFailed(e, admitted) // R1 memo on 403, as before; no further row
      }
    }
    console.info(
      '[business store days]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, action: 'closure.remove', date: row.date, at: renderNow().toISOString() }),
    )
    return { ok: true, closures: upcoming(all.filter((c) => c.id !== id)) }
  } catch (e) {
    return writeFailed(e, admitted)
  }
}

// ── R5 — special days: setSpecialOpenDays (+ add/remove-one) ────────────────

/** How the next array is computed from core's FRESH array (read immediately before the write). */
type SpecialPlan = (current: SpecialOpenDay[]) => { next: SpecialOpenDay[] } | { unchanged: true } | Refusal

/** R1's own primitive and the ONE place `storePolicies.set` is invoked. ⚖ PKT-S30 F7 — admit ONCE
 *  (a wrapper passes its own admission in; a direct caller is admitted here) → ONE fresh `get` →
 *  compute next → ONE `set` with the FULL array, sorted. ⚖ PKT-S31 R7 — NOT exported: no caller
 *  outside this file ever sent a whole array, so the array form is gone; the add/remove wrappers
 *  (validated + admitted) are the only way in. Past entries in core's array ride back unchanged.
 *  The only remaining lost-update window is between that `get` and the `set` (core's `set` takes no
 *  precondition — a core ask in the PR body). */
async function setSpecialOpenDays(storeId: string, plan: SpecialPlan, admitted: Admitted): Promise<SetSpecialOpenDaysResult> {
  const { actor, reach } = admitted
  let next: SpecialOpenDay[] = []
  try {
    const current = (await actor.reads.storePolicyGet(storeId)).special_open_days
    const planned = plan(current)
    if ('ok' in planned) return planned
    if ('unchanged' in planned) return { ok: true, specialOpenDays: fromToday(current) }
    next = planned.next
    const writer = reach.storeDaysWriterFor({ businessId: actor.businessId })
    const saved = await writer.storePolicies.set(storeId, { acting_staff_id: actor.sheet.staff_id, special_open_days: next })
    console.info(
      '[business store days]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, action: 'special.set', count: saved.special_open_days.length, at: renderNow().toISOString() }),
    )
    return { ok: true, specialOpenDays: fromToday(saved.special_open_days) }
  } catch (e) {
    // ⚖ PKT-S31 R4 — the user's own entry already passed this door's validation, so a core validation
    // refusal (a 4xx that is not 403 or the 409 duplicate) is about core's array, never the user's
    // times: the generic line on screen, core's words + the dates sent in the log.
    // ⚖ PKT-S32 R15 — core's duplicate MESSAGE is matched before the status branch (a 422 duplicate still prints the duplicate line).
    // ⚖ R17 — a 403 never takes this path: it stays forbidden below, so R1 clears the memo.
    if (isSynqedError(e) && e.status !== 403 && isDuplicateSpecial(e)) return { ok: false, reason: 'invalid', message: MSG.duplicateSpecial }
    if (isSynqedError(e) && e.status >= 400 && e.status < 500 && e.status !== 403 && e.status !== 409) {
      console.warn('[business store days] core refused the special days set:', e.status, e.message, JSON.stringify(next.map((d) => d.date)))
      return { ok: false, reason: 'core', message: MSG.genericFail }
    }
    return writeFailed(e, admitted)
  }
}

/** Add one entry: validation (R3) before anything, ONE admission, then `setSpecialOpenDays`'s own
 *  get → next → set (never a second call site of `storePolicies.set` — CP3's writers row is keyed
 *  to `setSpecialOpenDays` alone). */
export async function addSpecialOpenDay(storeId: string, input: { date: string; open: string; close: string }): Promise<SetSpecialOpenDaysResult> {
  if (practiceTenant() === null) return TENANT_REFUSAL
  const problem = validateDate(input.date) ?? validateSpecialTimes(input.open, input.close)
  if (problem) return invalid(problem)
  const admitted = await admitWriter(storeId)
  if (!admitted.ok) return admitted
  return setSpecialOpenDays(
    storeId,
    (current) => {
      if (isPastDate(input.date)) return invalid(MSG.pastDate) // Also-noted B — re-checked at write time
      if (current.some((d) => d.date === input.date)) return invalid(MSG.duplicateSpecial)
      if (current.length >= MAX_SPECIAL_DAYS) return invalid(MSG.specialCap)
      return { next: [...current, { date: input.date, open: input.open, close: input.close }].sort(byDate) }
    },
    admitted,
  )
}

/** Remove one entry (P3-2: the body is the FULL sorted array, like add). A date the fresh read lacks
 *  → ok with core's array, no `set` (P3-1). */
export async function removeSpecialOpenDay(storeId: string, date: string): Promise<SetSpecialOpenDaysResult> {
  if (practiceTenant() === null) return TENANT_REFUSAL
  const problem = validateDate(date)
  if (problem) return invalid(problem)
  const admitted = await admitWriter(storeId)
  if (!admitted.ok) return admitted
  return setSpecialOpenDays(
    storeId,
    (current) => {
      if (isPastDate(date)) return invalid(MSG.pastDate) // ⚖ PKT-S31 R3 — re-checked at write time, like the closure removal
      return current.some((d) => d.date === date) ? { next: current.filter((d) => d.date !== date).sort(byDate) } : { unchanged: true }
    },
    admitted,
  )
}

// ── the badge (R3/R8) — computed from CLOSURES, never from the special list ─

/** ⚖ PKT-S30 F12 — the badge rule's one home is store-days-state.ts; re-exported for data.ts.
 *  ⚖ PKT-S31 R5/R9 — so are the 特別営業日 order (`applySpecialOpenDays`) and the read-only line. */
export { applySpecialOpenDays, READ_ONLY_NOTE, specialDayBadge }
