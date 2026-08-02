// ───────────────────────────────────────────────────────────────────────────
// Shadow comparison + migration report assembly (Packet 2 §2/§3). OFFLINE
// ONLY in Packet 2 (contract §4): runs inside tests (fixtures) and inside the
// report runner (real rows) — never at a production call site. No runtime
// import of this module exists anywhere in the app.
//
// The bidirectional exit-gate proof (§2):
//   - for every legacy token `t` that has a v2 twin, and every staff `s`:
//     `had(s, t)` ⇔ every twin of `t` is in `s`'s proposed v2 set;
//   - no invention: every v2 token held traces back to a held legacy source.
// These are two separate checks — a mapper bug that grants a twin WITHOUT
// its sibling (e.g. karute_records.view without customer_identity.view, with
// customers.view itself not held) would satisfy neither `had(s,t) → v2Decision`
// alone; the invention pass below is what actually catches a lone-invented
// v2 token that a "did every twin land" check on the SOURCE token can miss.
// ───────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto'
import { ROLE_PRESETS } from '@/lib/auth/permissions'
import { mapLegacyRights, LEGACY_TO_V2_TWINS } from './map-legacy-rights'
import { CAPABILITIES_V2, type CapabilityV2, type LegacyRightsInput, type ProposedStaffRights, type StaffIdentity, type AmbiguityFlag } from './permissions-v2'

export interface ShadowRow {
  readonly subjectId: string
  readonly legacyToken: string
  readonly legacyDecision: boolean
  readonly v2Decision: boolean
  readonly status: 'match' | 'drift'
}

export function compareDecisions(
  input: LegacyRightsInput,
  proposed: ProposedStaffRights,
): ReadonlyArray<ShadowRow> {
  const legacyHeld = new Set(input.effectiveLegacy)
  const v2Held = new Set(proposed.capabilitiesV2)
  const rows: ShadowRow[] = []

  // Bidirectional check, one row per legacy token that has a twin. Sorted
  // key order keeps output deterministic regardless of object property order.
  for (const legacyToken of Object.keys(LEGACY_TO_V2_TWINS).sort()) {
    const twins = LEGACY_TO_V2_TWINS[legacyToken]
    const legacyDecision = legacyHeld.has(legacyToken)
    const v2Decision = twins.every((t) => v2Held.has(t))
    rows.push({
      subjectId: input.subjectId,
      legacyToken,
      legacyDecision,
      v2Decision,
      status: legacyDecision === v2Decision ? 'match' : 'drift',
    })
  }

  // Invention check: every HELD v2 token must trace back to its (singular)
  // legacy source token being held too. Each v2 token in CAPABILITIES_V2 maps
  // to exactly one legacy source per the §2 table — no v2 token is shared by
  // two legacy tokens.
  const sourceOf = new Map<CapabilityV2, string>()
  for (const [legacyToken, twins] of Object.entries(LEGACY_TO_V2_TWINS)) {
    for (const t of twins) sourceOf.set(t, legacyToken)
  }
  for (const v2Token of CAPABILITIES_V2) {
    if (!v2Held.has(v2Token)) continue
    const source = sourceOf.get(v2Token)
    const traced = source !== undefined && legacyHeld.has(source)
    if (!traced) {
      rows.push({
        subjectId: input.subjectId,
        legacyToken: `invented:${v2Token}`,
        legacyDecision: false,
        v2Decision: true,
        status: 'drift',
      })
    }
  }

  return rows
}

/** One row of the human-reviewable migration report — identity, source role,
 *  provenance, the legacy capabilities that were read, the proposed v2
 *  rights, and the ambiguity flags (mirrors `proposed.ambiguities`, hoisted
 *  to the top level so a report reader doesn't have to drill in). */
export interface StaffMappingRow {
  readonly identity: StaffIdentity
  readonly role: string
  readonly provenance: ProposedStaffRights['provenance']
  readonly legacyCapabilities: ReadonlyArray<string>
  readonly proposed: ProposedStaffRights
  readonly ambiguities: ReadonlyArray<AmbiguityFlag>
}

export interface MigrationReport {
  readonly sourceSha: string
  readonly generatedAtIso: string
  /** SHA-256 of the canonical JSON of ROLE_PRESETS — invalidates the report
   *  the moment a preset changes between generation and cutover (contract §1
   *  doc comment on MigrationReport), the same way APPROVED_SOURCE_SHA
   *  invalidates a drifted contract. */
  readonly presetHash: string
  readonly rows: ReadonlyArray<StaffMappingRow>
  /** Exactly the rows carrying `floating_staff_empty_assignment` — the input
   *  the owed Liam+Anthony floating-staff ruling needs (contract §2). */
  readonly emptyAssignmentAudit: ReadonlyArray<StaffMappingRow>
  readonly shadow: { readonly total: number; readonly drift: number }
}

/** Canonical JSON for hashing: sorted role keys, each capability array
 *  sorted — so key/array reordering never changes the hash. Exported (not
 *  part of the frozen §1 surface) so the test suite can pin the
 *  canonicalization invariant directly. */
export function canonicalRolePresetsJson(presets: Readonly<Record<string, ReadonlyArray<string>>>): string {
  const canonical: Record<string, string[]> = {}
  for (const role of Object.keys(presets).sort()) {
    canonical[role] = [...presets[role]].sort()
  }
  return JSON.stringify(canonical)
}

export function assembleMigrationReport(
  sourceSha: string,
  rows: ReadonlyArray<{ input: LegacyRightsInput; identity: StaffIdentity }>,
  // Not part of the frozen §1 signature — an optional trailing param (default
  // "now") keeps the function callable exactly as specified while still
  // being testable with a fixed clock.
  generatedAtIso: string = new Date().toISOString(),
): MigrationReport {
  let shadowTotal = 0
  let shadowDrift = 0

  const mappingRows: StaffMappingRow[] = rows.map(({ input, identity }) => {
    const proposed = mapLegacyRights(input)
    for (const shadowRow of compareDecisions(input, proposed)) {
      shadowTotal += 1
      if (shadowRow.status === 'drift') shadowDrift += 1
    }
    return {
      identity,
      role: input.role,
      provenance: proposed.provenance,
      legacyCapabilities: input.effectiveLegacy,
      proposed,
      ambiguities: proposed.ambiguities,
    }
  })

  mappingRows.sort((a, b) => a.identity.subjectId.localeCompare(b.identity.subjectId))

  const emptyAssignmentAudit = mappingRows.filter((r) =>
    r.ambiguities.some((a) => a.kind === 'floating_staff_empty_assignment'),
  )

  return {
    sourceSha,
    generatedAtIso,
    presetHash: createHash('sha256').update(canonicalRolePresetsJson(ROLE_PRESETS)).digest('hex'),
    rows: mappingRows,
    emptyAssignmentAudit,
    shadow: { total: shadowTotal, drift: shadowDrift },
  }
}
