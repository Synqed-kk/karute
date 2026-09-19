// THE AUDITED STORE LOCK — the impure twin of src/lib/auth/store-lock.ts.
//
// Its own module, not a function inside audit.ts, for one practical reason: a
// couple of dozen suites mock '@/lib/audit' wholesale, and a door that reached
// the twin through that module would find it undefined in every one of them.
// Living here, the twin's own `audit` import IS whatever those suites installed
// — so a suite already spying on audit() sees the refusal row for free, with no
// new mock entry. Same split, same reason, as store-lock.ts's own header.

import { audit, type AuditCategory, type AuditEvent } from '@/lib/audit'
import { ensureRecordStoreInScope, type RecordStoreScope } from '@/lib/auth/store-lock'

/** WHO refused, for a store-lock refusal row — the same actor idiom audit()
 *  itself takes, threaded by the door (neither transport has a session of its
 *  own down here). `actorId: null` is allowed: audit() already types it that
 *  way for system/cron events, and a refusal whose actor could not be resolved
 *  is still worth a row — the door and the target id are the story. */
export interface StoreRefusalActor {
  actorId: string | null
  businessId: string | null
  source: AuditEvent['source']
  requestId?: string
}

/** The closed set of ids a door may carry on `trace.detail` — ids only, one
 *  entry per caller found at the top of the stack (2f277902b):
 *  recording_session_id (karute.ts's save door) and appointment_id
 *  (appointments/mutations.ts's booking doors). */
export type StoreRefusalDetailKey = 'recording_session_id' | 'appointment_id'

/** One refusal action per door CATEGORY — the prefix that door's own SUCCESS
 *  rows already use, so the 種類 filter puts a refused karute write next to the
 *  karute writes that did land. (The packet named two; the door list it gives
 *  spans four categories — discard is a recording door, the autostart toggle a
 *  settings one — and the rule is one prefix per door.) */
const STORE_WRITE_REFUSED = {
  booking: 'booking.store_write_refused',
  karute: 'karute.store_write_refused',
  recording: 'recording.store_write_refused',
  settings: 'settings.store_write_refused',
} as const

/** The literal-union emit seam (contract §8 round-2 amendment E, the
 *  emitDeletionAudit idiom): CP4's scanner reads these four literals off this
 *  parameter's annotation, so the taxonomy stays provably complete even though
 *  the caller picks one by category. Keep the union INLINE — a named type
 *  alias reads as a non-literal action and the ban fires. */
function emitStoreWriteRefused(
  action:
    | 'booking.store_write_refused'
    | 'karute.store_write_refused'
    | 'recording.store_write_refused'
    | 'settings.store_write_refused',
  e: Omit<AuditEvent, 'action' | 'category' | 'actorType'> & { category: AuditCategory },
): void {
  // requestId spelled out although `e` already carries it: CP5's scanner reads
  // the call's own arguments, and a spread hides it.
  audit({ ...e, action, actorType: 'staff', requestId: e.requestId })
}

/**
 * THE AUDITED TWIN of ensureRecordStoreInScope (src/lib/auth/store-lock.ts) —
 * the same lock, plus ONE audit row for an out-of-store refusal. A degraded
 * assignment lookup is refused with the same error and is NOT recorded: an
 * infrastructure blip on the actor's own lookup is not a cross-store probe.
 *
 * WHY IT LIVES HERE AND NOT THERE (FRESH-EYES-P1 §5a: "someone probing another
 * branch's ids is exactly the event an owner would want to see"). The lock
 * itself is PURE — no session, no I/O, no imports beyond the error class — and
 * that purity is what lets Bearer-only routes reach it. An emitter is the
 * opposite, so the impure half sits beside audit() and composes the pure one.
 *
 * Auditing a REFUSAL does not break the success-only audit law: that law is
 * about CLAIMED actions, and a refusal claims nothing. The precedent is
 * recording.take_refused_has_record (audit-policy.ts), emitted beside
 * auditTakeNamed for exactly this reason.
 *
 * The row is fire-and-forget (audit() never throws) and the SAME error is
 * rethrown untouched — the not_found shape stays byte-identical to the pure
 * lock's, which is the whole existence-oracle argument (R9-2). READ locks are
 * deliberately NOT routed here: a read refusal fires on every legitimately
 * hidden row and would bury the probe it is meant to surface.
 *
 * ids only, never names — the PII rule at the top of src/lib/audit.ts, which
 * governs every sink this module reaches.
 */
export function ensureRecordStoreInScopeAudited(
  record: { store_id: string | null },
  scope: RecordStoreScope,
  notFoundMessage: string,
  trace: {
    actor: StoreRefusalActor
    /** The door's own category — picks the action, see STORE_WRITE_REFUSED. */
    category: keyof typeof STORE_WRITE_REFUSED
    targetType?: AuditEvent['targetType']
    targetId?: string
    /** WHICH door refused, in its own vocabulary: 'booking.cancel',
     *  'karute.entry_edit', 'recording.discard', … */
    door: string
    /** Ids the door wants on the row that its target fields cannot carry — a
     *  booking row's target is the CUSTOMER (house shape, mutations.ts), so the
     *  appointment id the caller actually probed rides here. ids only — the
     *  reserved keys below (door/record_store_id/code) always win, this can
     *  never override them. */
    detail?: Partial<Record<StoreRefusalDetailKey, string | null>>
  },
): void {
  try {
    ensureRecordStoreInScope(record, scope, notFoundMessage)
  } catch (err) {
    if (!scope.degraded) {
      emitStoreWriteRefused(STORE_WRITE_REFUSED[trace.category], {
        category: trace.category,
        actorId: trace.actor.actorId,
        businessId: trace.actor.businessId,
        targetType: trace.targetType,
        targetId: trace.targetId,
        // A cross-store write attempt is a security event, same tier as a PIN
        // lockout or a scheduled deletion — the viewer's 警告 strip.
        severity: 'warning',
        detail: {
          // trace.detail spreads FIRST — the reserved keys below always win,
          // even if a future door's detail object tried to carry one (Greptile,
          // P1b B1 review).
          ...trace.detail,
          door: trace.door,
          record_store_id: record.store_id,
          // Degraded lookup blips are not recorded; this row is an out-of-store
          // refusal, so its code is the pure lock's 'not_found'.
          code: err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : null,
        },
        requestId: trace.actor.requestId,
        source: trace.actor.source,
      })
    }
    throw err
  }
}
