// 自動録音 (auto-start) per-store toggle — the ONE write site, shared by the
// web action and the facade route (recording-integrity spec §8.1, PR A4).
//
// Directive-free by design, exactly like src/lib/recording/discard.ts: this
// function takes a caller-vouched `actor`, so it must never live in a
// 'use server' module where every export becomes a client-invokable entry
// point and a caller could name someone else on the receipt.
//
// THE ONE DELIBERATE AUDIT DEVIATION (spec §8.1 fix C1). Settings-blob writes
// are deliberately unaudited house-wide (audit-policy.ts's org-settings
// justification row: "the accepted parity rule, not a gap"). This key is the
// exception, with a stated reason: it is the switch that makes phones start
// recording on their own, and a 規程 that commits to operating rules the store
// can verify (PPC Q&A A5-7) cannot rest on a setting with no record of being
// changed. The exception is ONE key wide — every other settings key keeps the
// parity rule.
//
// THE TOGGLE IS INERT UNTIL A7. Nothing reads this list yet; A7 wires arm
// condition 5 to it. That is the spec's own phasing (§14.1), stated plainly
// rather than papered over.
//
// CONCURRENCY, honestly bounded (spec §8.1 discipline). The blob writer is a
// read-modify-write with a shallow spread and no optimistic lock, so:
//   (a) only the one key is ever sent, on and off alike;
//   (b) the new array is computed HERE, from a server-side fresh read of the
//       blob, never from an array the client assembled — a client array is a
//       whole-list overwrite carrying whatever it last saw;
//   (c) callers re-read after the write, so a clobbered toggle is visible
//       immediately rather than believed.
// This narrows the window; it does not close it. Two admins flipping two
// different stores in the same instant can still lose one flip — and, because
// the audit row is written after a successful upsert, the log would then carry
// a flip the blob no longer reflects. The honest close is a real per-store
// settings row, core-side (§13.11).

import type { SynqedClient } from '@synqed-kk/client'
import { audit } from '@/lib/audit'
import { orgSettingsWithClient, writeOrgSettingsBlobWithClient } from '@/actions/org-settings'

type AutostartClient = Pick<SynqedClient, 'orgSettings' | 'stores'>

export interface RecordingAutostartActor {
  /** Auth user UUID of the staff member flipping the switch. */
  staffId: string | null
  businessId: string | null
  source: 'facade' | 'web'
  requestId?: string
}

export type SetRecordingAutostartResult =
  | { ok: true; storeIds: string[] }
  | { ok: false; error: 'forbidden' | 'unknown_store' | 'failed' }

/** Flip 自動録音 for ONE store. Fresh-read → compute → write the single key →
 *  receipt. Returns the resulting id list so the caller re-renders from what
 *  the server actually stored, never from its own optimistic guess. */
export async function setRecordingAutostartWithClient(
  synqed: AutostartClient,
  actor: RecordingAutostartActor,
  storeId: string,
  enabled: boolean,
): Promise<SetRecordingAutostartResult> {
  // An unattributable governance row is worse than no row. Both callers
  // resolve the actor from an authenticated session, so this is unreachable
  // today — which is the point: it holds by construction, not by call path.
  if (!actor.staffId || !actor.businessId) return { ok: false, error: 'forbidden' }
  if (typeof storeId !== 'string' || storeId.length === 0) {
    return { ok: false, error: 'unknown_store' }
  }

  let current: string[]
  try {
    // Store membership FIRST — a receipt-grade governance row must never
    // carry a store id this business does not own. The client is business-
    // scoped, so this also can't be answered with another tenant's list.
    const { stores } = await synqed.stores.list()
    if (!stores.some((s) => s.id === storeId)) return { ok: false, error: 'unknown_store' }

    // Fresh read — deliberately NOT getOrgSettings(), whose unstable_cache
    // holds for 300s: computing a new list off a 5-minute-old one would drop
    // any flip made in between.
    const settings = await orgSettingsWithClient(synqed)
    current = settings?.recording_autostart_store_ids ?? []
  } catch {
    return { ok: false, error: 'failed' }
  }

  const next = enabled
    ? current.includes(storeId)
      ? current
      : [...current, storeId]
    : current.filter((id) => id !== storeId)

  // ONLY the toggle key (§8.1 discipline a) — the blob writer merges it over
  // a fresh read of everything else.
  const result = await writeOrgSettingsBlobWithClient(synqed, {
    recording_autostart_store_ids: next,
  })
  if ('error' in result) return { ok: false, error: 'failed' }

  return emitAutostartReceipt(actor, storeId, enabled, next)
}

/** The §10.3 row, on write success ONLY — one flip, exactly one row.
 *
 *  Split out as its own function so the exported twin above stays free of a
 *  literal audit() call in its subtree: CP7's registry-reality scan would
 *  otherwise demand an AUDITED_CORES entry, and registering one opens an
 *  SDK-write allowlist-exemption span over the whole symbol (the A1 doctrine
 *  — see FACADE_AUDIT_MAP['orgSettings.recordingAutostart']'s coveredBy note).
 *  The emission walker reads the call-through shape directly. */
function emitAutostartReceipt(
  actor: RecordingAutostartActor,
  storeId: string,
  enabled: boolean,
  storeIds: string[],
): SetRecordingAutostartResult {
  audit({
    category: 'settings',
    action: 'settings.recording_autostart_toggle',
    actorId: actor.staffId,
    actorType: 'staff',
    businessId: actor.businessId,
    targetType: 'store',
    targetId: storeId,
    // Consequential and disputable — the same tier as permissions/store
    // writes, not an ordinary 'info'.
    severity: 'notice',
    requestId: actor.requestId,
    source: actor.source,
    // spec §10.3 exactly: ids and flags. `actor_staff_id` is the
    // authenticated actor, never a body value; no store NAME, no count of
    // anything a reader could mistake for content (§10.4).
    detail: {
      store_id: storeId,
      enabled,
      actor_staff_id: actor.staffId,
    },
  })
  return { ok: true, storeIds }
}
