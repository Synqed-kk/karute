// ───────────────────────────────────────────────────────────────────────────
// Faithful legacy → v2 rights mapper (Packet 2 §2). Pure, deterministic,
// single export. Consumes the OUTPUT of the real effectiveCapabilities()
// chokepoint (src/lib/auth/permissions.ts) — callers resolve that first, so
// stale-row self-healing (e.g. the non-owner recordings.viewAll strip)
// carries over for free; this module never re-derives it.
//
// Faithful = nobody loses access at migration (Liam ruling, §9.4): a legacy
// token that grants two things today (customers.view) grants both v2 twins,
// never a silently narrowed subset. The Front-Desk split is a later,
// deliberate preset/override decision — not something this mapper invents.
// ───────────────────────────────────────────────────────────────────────────

import { CAPABILITIES } from '@/lib/auth/permissions'
import {
  CAPABILITIES_V2,
  type CapabilityV2,
  type LegacyRightsInput,
  type ProposedStaffRights,
  type AmbiguityFlag,
} from './permissions-v2'

/**
 * The token mapping table (contract §2, exhaustive — every legacy token not
 * listed here has NO v2 twin and passes through the shadow untouched).
 * Exported so shadow-compare.ts can invert it for the bidirectional +
 * invention checks without a second copy of the table. NOTE: this export is a
 * disclosed deviation from the contract's literal "single export" label on
 * this file (§1) — same class as the other "not part of the frozen block"
 * additions; one shared table beats two drifting copies.
 */
export const LEGACY_TO_V2_TWINS: Readonly<Record<string, ReadonlyArray<CapabilityV2>>> = {
  'customers.view': ['customer_identity.view', 'karute_records.view'],
  'bookings.manage': ['booking_desk.view', 'booking_desk.manage'],
  'records.write': ['karute_records.write'],
  'records.delete': ['karute_records.delete'],
}

const KNOWN_LEGACY_TOKENS = new Set<string>(CAPABILITIES)

export function mapLegacyRights(input: LegacyRightsInput): ProposedStaffRights {
  // v2 capability set: union of twins for every held legacy token that has
  // one. A Set absorbs duplicate/reordered `effectiveLegacy` entries; filtering
  // CAPABILITIES_V2 (rather than iterating the Set) yields the canonical
  // declared order regardless of input order — both required for the §6
  // determinism matrix.
  const heldV2 = new Set<CapabilityV2>()
  for (const token of input.effectiveLegacy) {
    const twins = LEGACY_TO_V2_TWINS[token]
    if (twins) for (const t of twins) heldV2.add(t)
  }
  const capabilitiesV2 = CAPABILITIES_V2.filter((c) => heldV2.has(c))

  const ambiguities: AmbiguityFlag[] = []

  // Store-access mode (§2): viewAll wins; else non-empty assignment → ASSIGNED
  // (sorted, deduped); else ALL + the empty-assignment flag. Never NONE.
  let storeAccessMode: ProposedStaffRights['storeAccessMode']
  let assignedStoreIds: ReadonlyArray<string>
  if (input.hasStoresViewAll) {
    storeAccessMode = 'ALL'
    assignedStoreIds = []
  } else if (input.assignedStoreIds.length > 0) {
    storeAccessMode = 'ASSIGNED'
    assignedStoreIds = Array.from(new Set(input.assignedStoreIds)).sort()
  } else {
    storeAccessMode = 'ALL'
    assignedStoreIds = []
    ambiguities.push({ kind: 'floating_staff_empty_assignment' })
  }

  // Unknown-token audit: tokens in the RAW stored override that aren't a real
  // legacy capability at all (typos / retired / future tokens). These are
  // silently dropped by effectiveCapabilities()'s own `valid.has` filter —
  // this flag is what makes that silent drop visible to the migration
  // reviewer. Deduped + sorted so duplicated/reordered overrides can't change
  // the flagged list (§6 determinism).
  if (input.storedOverride) {
    const dropped = Array.from(
      new Set(input.storedOverride.filter((t) => !KNOWN_LEGACY_TOKENS.has(t))),
    ).sort()
    if (dropped.length > 0) {
      ambiguities.push({ kind: 'override_carried_unknown_tokens', dropped })
    }
  }

  return {
    subjectId: input.subjectId,
    // storedOverride is non-null (even if empty) → this staff's rights come
    // from an explicit per-staff override, not the role preset (contract §2 /
    // mirrors effectiveCapabilities' `override ?? presetCapabilities(role)`).
    provenance: input.storedOverride !== null ? 'override' : 'preset',
    storeAccessMode,
    assignedStoreIds,
    capabilitiesV2,
    // The current model has no per-store capabilities — never invent entries
    // an owner didn't create (contract §1 doc comment on ProposedStaffRights).
    perStoreCapabilitiesV2: {},
    ambiguities,
  }
}
