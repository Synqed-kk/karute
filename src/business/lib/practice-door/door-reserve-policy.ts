// 受付ルール — THE RESERVE-POLICY WRITER (Reserve S66, DESIGN-BUILD2 §3.2 + §9 R2/R9/R16), door-store-capabilities.ts's twin.
// Its own file because the audit allowlist holds ONE entry per file::call (R-S39-1): door-writes.ts's
// `storePolicies.set` entry is the special-days writer's, so a second call site = a new key = a new file.
// door-writes.ts is the shared-cores door and data.ts is its ONE importer (business-isolation.test.ts), so this
// file cannot borrow its admission: it walks the same steps itself, in the same order (store isolation →
// `settings.manage` → core's HQ_ADMIN grant), with the same helpers door-booking-colors.ts uses (`practiceActor`,
// `visibleIds`, door.ts's `canManageSettings`), and the same write-only handle as door-writes.ts
// (core-reach's `storeDaysWriterFor`). Core's own requireHqAdmin and store-in-business 404 are the second net.
// data.ts is its only importer.

import { practiceActor, visibleIds, type PracticeActor } from './actor'
import { practiceTenant } from './switch'
import { canManageSettings } from './door'
import { renderNow } from '../clock'
import { READ_ONLY_NOTE } from '../store-days-state'
import { parseReservePolicy, pickReservePolicy, policyHash, reservePolicyProblem, type ReservePolicy } from './reserve-policy'

// 'stale' belongs to this write alone: the shared store-days Reason feeds four-reason STATUS maps (two routes).
type Reason = 'forbidden' | 'tenant' | 'invalid' | 'stale' | 'core'
/** `basedOn` is the saved row's fingerprint, the next save's precondition (R9). */
export type SetReservePolicyResult =
  | { ok: true; row: ReservePolicy & { updated_at: string | null }; basedOn: string }
  | { ok: false; reason: Reason; message: string }

// DESIGN-BUILD2 §4 + §9 R5/R9 — native JP, listed for the blind pass. The stale line follows お店ページ's
// (store-page/copy.ts); the failure line is the store-days line without its schedule-list clause.
const MSG = {
  stale: 'この店舗の受付ルールが、このページを開いたあとにほかの画面や端末で保存されたため、保存できませんでした。最新の設定を確認してから、もう一度変更してください。',
  range: '設定できる範囲を超えた値があるため、保存できませんでした。',
  cutoffOverOpen: '直前締切が受付期間より長いため、予約できる枠がなくなります',
  freeOverOpen: '無料キャンセル期限が受付期間より長いため、すべての予約が期限後になります',
  lateFromBooking: '直前締切が無料キャンセル期限より短いため、期限を過ぎてから入った予約は、最初からキャンセル料の対象になります。',
  readOnly: READ_ONLY_NOTE,
  fail: 'いまは保存できないため、時間をおいてもう一度保存してください。',
} as const
/** §9 R5 — shown (never refused) when the cutoff is shorter than the free-cancel deadline. */
export const LATE_FROM_BOOKING_NOTE = MSG.lateFromBooking

const refuse = (reason: Reason, message: string): { ok: false; reason: Reason; message: string } => ({ ok: false, reason, message })

/** Recognised by SHAPE, never `instanceof` — this file imports no SDK class (door-writes.ts's own rule). */
function isSynqedError(e: unknown): e is { name: string; status: number; message: string } {
  return e instanceof Error && e.name === 'SynqedError' && typeof (e as { status?: unknown }).status === 'number'
}

/** R16 — core's own write guard, asked before the write: an OWNER passes `requireHqAdmin` by role, anyone else
 *  needs a LIVE HQ_ADMIN grant. Asked once per save (a save is rare; nothing is memoized here). */
async function hasHqGrant(actor: PracticeActor): Promise<boolean> {
  return actor.sheet.coarse_role === 'OWNER' || (await actor.reads.businessGrantsCheck(actor.card.id)).granted
}

/** The six booking rules of one store, written to core's per-store row. Order: OFF → shape, core's ranges and the
 *  §4 checks (all pure, before any call) → lazy core-reach → actor → store isolation → settings.manage → HQ grant →
 *  ONE fresh `get` → `policyHash(current) !== basedOn` → 'stale' → the same six as stored → ok with no `set` (core
 *  would file no audit row for it anyway; this keeps updated_at still) → ONE `set` carrying ONLY the six fields. The window
 *  between that `get` and the `set` is unguarded: core's PUT takes no precondition yet (CORE-44 is ordered, not on
 *  main), so two saves inside it can still cross. A core failure is reported, never swallowed or retried. */
export async function setReservePolicy(storeId: string, draft: unknown, basedOn: string): Promise<SetReservePolicyResult> {
  if (practiceTenant() === null) return refuse('tenant', MSG.fail)
  const next = parseReservePolicy(draft)
  if (next === null || typeof storeId !== 'string' || storeId === '' || typeof basedOn !== 'string') return refuse('invalid', MSG.range)
  const problem = reservePolicyProblem(next)
  if (problem) return refuse('invalid', MSG[problem])
  const reach = await import('./core-reach') // lazy, like door.ts: the OFF path never loads the SDK
  let actor: PracticeActor
  try {
    actor = await practiceActor()
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return refuse('tenant', MSG.fail)
    console.error('[business reserve policy] core did not answer:', e instanceof Error ? e.message : String(e))
    return refuse('core', MSG.fail)
  }
  if (!visibleIds(actor).includes(storeId)) return refuse('forbidden', MSG.readOnly)
  if (!canManageSettings(actor)) return refuse('forbidden', MSG.readOnly)
  try {
    if (!(await hasHqGrant(actor))) return refuse('forbidden', MSG.readOnly)
    const read = await actor.reads.storePolicyGet(storeId)
    const current = pickReservePolicy(read)
    if (policyHash(current) !== basedOn) return refuse('stale', MSG.stale)
    if (policyHash(next) === basedOn) return { ok: true, row: { ...current, updated_at: read.updated_at }, basedOn }
    const writer = reach.storeDaysWriterFor({ businessId: actor.businessId })
    const saved = await writer.storePolicies.set(storeId, { acting_staff_id: actor.sheet.staff_id, ...next })
    const row = pickReservePolicy(saved)
    console.info(
      '[business reserve policy]',
      JSON.stringify({ business_id: actor.businessId, actor: actor.card.id, store_id: storeId, old: current, new: row, at: renderNow().toISOString() }),
    )
    return { ok: true, row: { ...row, updated_at: saved.updated_at }, basedOn: policyHash(row) }
  } catch (e) {
    if (e instanceof reach.PracticeTenantMismatch) return refuse('tenant', MSG.fail)
    if (isSynqedError(e) && e.status === 403) return refuse('forbidden', MSG.readOnly)
    // English never reaches the screen — logged for whoever reads the server console.
    console.error('[business reserve policy] core did not save:', isSynqedError(e) ? `${e.status} ${e.message}` : e instanceof Error ? e.message : String(e))
    return refuse('core', MSG.fail)
  }
}
