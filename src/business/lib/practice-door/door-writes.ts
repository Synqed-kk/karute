// PKT-S29-B1 — the Business write door for 臨時休業 (StoreClosedDay) +
// 特別営業日 (special_open_days), per store, in 設定 store-hours. ONE file
// calls the three core writes this door owns: `storePolicies.set` (used by
// `setSpecialOpenDays`), `storePolicies.addClosedDay` and
// `storePolicies.removeClosedDay` — core-reach.ts hands over only the bound
// client handle (`storeDaysWriterFor`), it never calls them itself.
//
// ⚠ FENCE SEQUENCING (lead's fold, PKT-S29-B1 stage report) — the
// business-territory.json "writers" rows for these three call sites are
// landing in their OWN, non-Business PR: check-business-isolation.mjs's own
// header states that list "is outside territory on purpose: it lands in its
// own non-Business PR before any territory code that writes," exactly the
// precedent door.ts's card-colour writer and door-booking-colors.ts's writer
// followed. Until that PR merges, CP3's business-writer pairing test
// (audit-sdk-write-sites.test.ts) reports these three sites as unpaired — a
// KNOWN, EXPECTED red, not a defect in this file.
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

// ── shared result shapes ─────────────────────────────────────────────────────

type StorePolicy = Awaited<ReturnType<CoreReads['storePolicyGet']>>
export type SpecialOpenDay = StorePolicy['special_open_days'][number]
type ClosedDaysRead = Awaited<ReturnType<CoreReads['storePolicyListClosedDays']>>
export type StoreClosedDay = ClosedDaysRead['closed_days'][number]

export interface StoreDaysRead {
  closures: StoreClosedDay[]
  specialOpenDays: SpecialOpenDay[]
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
  invalidDate: '存在しない日付です。',
  pastDate: '過ぎた日付です',
  openNotBeforeClose: '閉店時刻は開店時刻より後にしてください。',
  duplicateSpecial: 'その日はすでに特別営業日です',
  duplicateClosure: 'その日はすでに臨時休業です',
  readOnly: '変更には本部の権限が必要です。',
  genericFail: 'いまは保存できないため、時間をおいてもう一度保存してください（予定の一覧はこれまでのままです）。',
  readFailure: 'いまは予定を読み込めないため、時間をおいてページを再読み込みしてください。',
} as const
/** 特別営業日 block note (R8) and the badge (R3/R8 folded — see MSG above for
 *  the badge itself); both live here so the UI layer imports copy from ONE
 *  home rather than restating it. */
export const SPECIAL_OPEN_DAYS_NOTE = '通常の営業時間とは別に営業する、その日限りの予定です。'
export const SPECIAL_OPEN_DAYS_BADGE = '臨時休業より優先'
export const READ_FAILURE_LINE = MSG.readFailure
export const READ_ONLY_NOTE = MSG.readOnly
export const ADD_PENDING_LABEL = '追加中'
export const REMOVE_PENDING_LABEL = '取り消し中'

// ── R2 — capability, honest ──────────────────────────────────────────────────

/** ⚖ R2(c) (lead's fold — the SDK exposes the grants check, so this branch is
 *  the only one that applies; the packet's "no such method" branch is
 *  deleted): an OWNER always passes core's own `requireHqAdmin`; anyone else
 *  needs a LIVE HQ_ADMIN grant. ONE call per actor (memoized on the actor's own
 *  bound reads, like door.ts's `orgSettingsOf`'s `ORG_ONCE`) — P-B1-4 pins that
 *  a second write attempt by the same actor never asks core the grant
 *  question twice. */
const HQ_ONCE = Symbol('HQ_ADMIN check, once per actor')
async function isHqAdmin(actor: PracticeActor): Promise<boolean> {
  if (actor.sheet.coarse_role === 'OWNER') return true
  const reads: PracticeActor['reads'] & { [HQ_ONCE]?: Promise<boolean> } = actor.reads
  return (reads[HQ_ONCE] ??= actor.reads.businessGrantsCheck(actor.card.id).then((r) => r.granted))
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
export async function canWriteStoreDays(storeId: string): Promise<boolean> {
  const actor = await practiceActor()
  return canWriteStoreDaysFor(actor, storeId)
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

function mapCoreError(e: unknown, reach: typeof import('./core-reach')): Refusal {
  if (e instanceof reach.PracticeTenantMismatch) return { ok: false, reason: 'tenant', message: MSG.genericFail }
  if (isSynqedError(e)) {
    if (e.status === 403) return { ok: false, reason: 'forbidden', message: MSG.readOnly }
    if (e.message === 'This date is already a closed day for the store.') {
      return { ok: false, reason: 'invalid', message: MSG.duplicateClosure }
    }
    if (e.message === 'Special open dates must be unique') return { ok: false, reason: 'invalid', message: MSG.duplicateSpecial }
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
const TENANT_REFUSAL: Refusal = { ok: false, reason: 'tenant', message: MSG.genericFail }
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
  if (!(await canWriteStoreDaysFor(admitted.actor, storeId))) return FORBIDDEN
  return admitted
}

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
  try {
    const [policy, closedDays] = await Promise.all([
      actor.reads.storePolicyGet(storeId),
      actor.reads.storePolicyListClosedDays(storeId, { from: todayJst() }),
    ])
    return { ok: true, closures: closedDays.closed_days, specialOpenDays: policy.special_open_days }
  } catch (e) {
    return mapCoreError(e, reach)
  }
}

// ── R6 — closures: addClosedDay / removeClosedDay ───────────────────────────

export async function addClosedDay(storeId: string, input: { date: string; reason: string }): Promise<AddClosedDayResult> {
  if (practiceTenant() === null) return TENANT_REFUSAL
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
    // this is the closure add's own event, opted into via the SDK's `audit` field.
    const row = await writer.storePolicies.addClosedDay(storeId, { date: input.date, reason: input.reason === '' ? null : input.reason, acting_staff_id: actor.sheet.staff_id, audit: { actor_type: 'staff', actor_id: actor.sheet.staff_id, category: 'settings', action: 'store_closed_day.add', target_type: 'store_closed_day' } })
    console.info(
      '[business store days]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, action: 'closure.add', date: row.date, at: renderNow().toISOString() }),
    )
    return { ok: true, row }
  } catch (e) {
    return mapCoreError(e, reach)
  }
}

/** ⚖ lead's fold #2 — core's SDK `removeClosedDay(storeId, id, actingStaffId)`
 *  takes NO audit payload and HARD-DELETES the row (`tx.storeClosedDay.delete`,
 *  EV/CORE-READ-B1.md Q2) — a genuine exception to the standing "nothing
 *  deleted, soft only" rule, flagged in the PR body as a core ask, not fixed
 *  here. The door records its own audit event for the removal through the
 *  write-only `{ audit: { log } }` handle — a failed audit call is logged and
 *  never turned into a refusal of a removal core already completed.
 *  ⚖ PKT-S30 F9 — the fresh read (no from-date filter) already lacks the id →
 *  another admin removed it: ok, no core call, the list refreshed from that read.
 *  P3-9 — a closure dated before today is a record: refused, no write. */
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
    await writer.storePolicies.removeClosedDay(storeId, id, actor.sheet.staff_id)
    try {
      const auditHandle = reach.auditWriterFor({ businessId: actor.businessId })
      await auditHandle.audit.log({
        actor_type: 'staff',
        actor_id: actor.sheet.staff_id,
        category: 'settings',
        action: 'store_closed_day.remove',
        target_type: 'store_closed_day',
        target_id: id,
        detail: { date: row.date, reason: row.reason },
      })
    } catch (auditErr) {
      console.error('[business store days] audit record failed after a real removal:', auditErr instanceof Error ? auditErr.message : String(auditErr))
    }
    console.info(
      '[business store days]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, action: 'closure.remove', date: row.date, at: renderNow().toISOString() }),
    )
    return { ok: true, closures: upcoming(all.filter((c) => c.id !== id)) }
  } catch (e) {
    return mapCoreError(e, reach)
  }
}

// ── R5 — special days: setSpecialOpenDays (+ add/remove-one) ────────────────

/** How the next array is computed from core's FRESH array (read immediately before the write). */
type SpecialPlan = (current: SpecialOpenDay[]) => { next: SpecialOpenDay[] } | { unchanged: true } | Refusal

function specialListProblem(list: SpecialOpenDay[]): string | null {
  const seen = new Set<string>()
  for (const d of list) {
    if (!isRealCalendarDate(d.date)) return MSG.invalidDate
    const times = validateSpecialTimes(d.open, d.close)
    if (times) return times
    if (seen.has(d.date)) return MSG.duplicateSpecial
    seen.add(d.date)
  }
  return null
}

/** R1's own primitive and the ONE place `storePolicies.set` is invoked. ⚖ PKT-S30 F7 — admit ONCE
 *  (a wrapper passes its own admission in; a direct caller is admitted here) → ONE fresh `get` →
 *  compute next → ONE `set` with the FULL array, sorted. P3-4 — a direct caller's array replaces the
 *  entries from today on; past entries in core's array are sent back unchanged (nothing deleted).
 *  The only remaining lost-update window is between that `get` and the `set` (core's `set` takes no
 *  precondition — a core ask in the PR body). */
export async function setSpecialOpenDays(storeId: string, input: SpecialOpenDay[] | SpecialPlan, pre?: Admitted): Promise<SetSpecialOpenDaysResult> {
  let plan: SpecialPlan
  if (typeof input === 'function') plan = input
  else {
    if (practiceTenant() === null) return TENANT_REFUSAL
    const problem = specialListProblem(input)
    if (problem) return invalid(problem)
    const upcoming = input.filter((d) => !isPastDate(d.date))
    plan = (current) => ({ next: [...current.filter((d) => isPastDate(d.date)), ...upcoming].sort(byDate) })
  }
  const admitted = pre ?? (await admitWriter(storeId))
  if (!admitted.ok) return admitted
  const { actor, reach } = admitted
  try {
    const current = (await actor.reads.storePolicyGet(storeId)).special_open_days
    const planned = plan(current)
    if ('ok' in planned) return planned
    if ('unchanged' in planned) return { ok: true, specialOpenDays: current }
    const next = planned.next
    const writer = reach.storeDaysWriterFor({ businessId: actor.businessId })
    const saved = await writer.storePolicies.set(storeId, { acting_staff_id: actor.sheet.staff_id, special_open_days: next })
    console.info(
      '[business store days]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, action: 'special.set', count: saved.special_open_days.length, at: renderNow().toISOString() }),
    )
    return { ok: true, specialOpenDays: saved.special_open_days }
  } catch (e) {
    return mapCoreError(e, reach)
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
      if (current.length >= MAX_SPECIAL_DAYS) return invalid(MSG.genericFail)
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
    (current) => (current.some((d) => d.date === date) ? { next: current.filter((d) => d.date !== date).sort(byDate) } : { unchanged: true }),
    admitted,
  )
}

// ── the badge (R3/R8) — computed from CLOSURES, never from the special list ─

/** 「臨時休業の日に特別営業」→ folded to 「臨時休業より優先」(copy round). A
 *  special day badges when its date is ALSO a closure date — the source of
 *  truth is the CLOSURES array, never the special list itself (R3: "computed
 *  from the CLOSURES list, never from the special list"). */
export function specialDayBadge(date: string, closures: readonly StoreClosedDay[]): string | null {
  return closures.some((c) => c.date === date) ? SPECIAL_OPEN_DAYS_BADGE : null
}
