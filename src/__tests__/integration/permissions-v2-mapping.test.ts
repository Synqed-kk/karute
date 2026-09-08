/**
 * Coverage for the Packet 2 permission-v2 mapping lane (contract §6):
 *   - src/lib/workspaces/permissions-v2.ts   (types + fail-closed role parse)
 *   - src/lib/workspaces/map-legacy-rights.ts (the faithful mapper)
 *   - src/lib/workspaces/shadow-compare.ts    (bidirectional shadow + report)
 *
 * `effectiveLegacy` fixtures are built by calling the real
 * `effectiveCapabilities()` chokepoint (via buildInput), so they can't drift
 * from the real role presets — and the chokepoint's treatment of an explicit
 * recordings.viewAll override is exercised for real, not assumed. ONE
 * deliberate exception: the determinism
 * test hand-types its scrambled/canonical inputs, because its subject is the
 * mapper's set/sort logic under adversarial input shape, not preset fidelity.
 */
import {
  effectiveCapabilities,
  presetCapabilities,
  PERMISSION_ROLES,
  type PermissionRole,
} from '@/lib/auth/permissions'
import { mapLegacyRights } from '@/lib/workspaces/map-legacy-rights'
import {
  compareDecisions,
  assembleMigrationReport,
  canonicalRolePresetsJson,
} from '@/lib/workspaces/shadow-compare'
import {
  CAPABILITIES_V2,
  parseRoleFailClosed,
  type CapabilityV2,
  type LegacyRightsInput,
  type ProposedStaffRights,
  type StaffIdentity,
} from '@/lib/workspaces/permissions-v2'

// Counts every table-driven / dedicated case that actually RAN — the final
// test in this file asserts this against a statically-known total, so a
// test.each silently discovering zero rows (an empty fixture array) fails
// loudly instead of reporting a false-positive green run.
let executedCaseCount = 0

function buildInput(params: {
  subjectId: string
  role: string
  storedOverride?: ReadonlyArray<string> | null
  assignedStoreIds?: ReadonlyArray<string>
}): LegacyRightsInput {
  const parsedRole = parseRoleFailClosed(params.role)
  const override = params.storedOverride ?? null
  const effective = effectiveCapabilities(parsedRole, override)
  return {
    subjectId: params.subjectId,
    role: params.role,
    storedOverride: override,
    effectiveLegacy: [...effective],
    assignedStoreIds: params.assignedStoreIds ?? [],
    hasStoresViewAll: effective.has('stores.viewAll'),
  }
}

function identityFor(subjectId: string): StaffIdentity {
  return { subjectId, displayName: subjectId, email: `${subjectId}@example.test` }
}

function unknownTokensFlag(proposed: ProposedStaffRights): ReadonlyArray<string> | undefined {
  const flag = proposed.ambiguities.find((a) => a.kind === 'override_carried_unknown_tokens')
  return flag && flag.kind === 'override_carried_unknown_tokens' ? flag.dropped : undefined
}

// ─── 1. Preset rows (6) — exact expected v2 set per role ───────────────────

const PRESET_CASES: ReadonlyArray<{ role: PermissionRole; expectedV2: CapabilityV2[] }> = [
  { role: 'owner', expectedV2: [...CAPABILITIES_V2] },
  { role: 'manager', expectedV2: [...CAPABILITIES_V2] },
  { role: 'senior', expectedV2: [...CAPABILITIES_V2] },
  {
    role: 'practitioner',
    expectedV2: [
      'customer_identity.view',
      'karute_records.view',
      'karute_records.write',
      'booking_desk.view',
      'booking_desk.manage',
    ],
  },
  {
    // Faithful — NOT yet separated: frontdesk keeps BOTH customer_identity.view
    // and karute_records.view (contract §6).
    role: 'frontdesk',
    expectedV2: ['customer_identity.view', 'karute_records.view', 'booking_desk.view', 'booking_desk.manage'],
  },
  { role: 'custom', expectedV2: [] },
]

// Every real preset role is covered, no more, no less — a future role
// addition/removal fails this instead of silently under-testing.
test('PRESET_CASES covers exactly PERMISSION_ROLES', () => {
  expect([...PRESET_CASES.map((c) => c.role)].sort()).toEqual([...PERMISSION_ROLES].sort())
})

test.each(PRESET_CASES)('preset $role → exact v2 set + preset provenance', ({ role, expectedV2 }) => {
  executedCaseCount++
  const input = buildInput({ subjectId: `preset-${role}`, role })
  const proposed = mapLegacyRights(input)
  expect(proposed.capabilitiesV2).toEqual(expectedV2)
  expect(proposed.provenance).toBe('preset')
  // Stated invariant (ProposedStaffRights doc): the legacy mapper never
  // invents per-store entries — pinned for every role, not assumed.
  expect(proposed.perStoreCapabilitiesV2).toEqual({})
})

// ─── 2. Override rows — override wins, unknown tokens dropped + flagged ────

const OVERRIDE_CASES = [
  {
    name: 'override replaces the preset entirely + drops & flags an unknown token',
    role: 'frontdesk',
    storedOverride: ['customers.view', 'records.write', 'made.up.token'],
    expectedV2: ['customer_identity.view', 'karute_records.view', 'karute_records.write'],
    expectedDropped: ['made.up.token'],
  },
  {
    name: 'an explicit EMPTY override still counts as override provenance (non-null, not falsy)',
    role: 'owner',
    storedOverride: [],
    expectedV2: [],
    expectedDropped: [],
  },
  {
    name: 'multiple unknown tokens in the override are deduped + sorted',
    role: 'custom',
    storedOverride: ['z.unknown', 'a.unknown', 'a.unknown', 'records.write'],
    expectedV2: ['karute_records.write'],
    expectedDropped: ['a.unknown', 'z.unknown'],
  },
  {
    // A KNOWN legacy token with no v2 twin (billing.manage) is neither
    // flagged unknown NOR contributes to capabilitiesV2 — the "passes through
    // the shadow untouched" claim, distinguished from a genuinely unknown token.
    name: 'known-but-twinless token: not flagged, contributes nothing to v2',
    role: 'custom',
    storedOverride: ['customers.view', 'billing.manage'],
    expectedV2: ['customer_identity.view', 'karute_records.view'],
    expectedDropped: [],
  },
]

test.each(OVERRIDE_CASES)('override: $name', ({ role, storedOverride, expectedV2, expectedDropped }) => {
  executedCaseCount++
  const input = buildInput({ subjectId: `override-${role}`, role, storedOverride })
  const proposed = mapLegacyRights(input)
  expect(proposed.capabilitiesV2).toEqual(expectedV2)
  expect(proposed.provenance).toBe('override')
  expect(unknownTokensFlag(proposed)).toEqual(expectedDropped.length > 0 ? expectedDropped : undefined)
})

// ─── 3. Chokepoint parity ───────────────────────────────────────────────────

test('chokepoint parity: an explicit non-owner recordings.viewAll override PASSES the chokepoint (it IS a grant); it has no v2 twin, so the v2 set is unchanged', () => {
  executedCaseCount++
  const grantedOverride = [...presetCapabilities('practitioner'), 'recordings.viewAll']
  const input = buildInput({ subjectId: 'granted-recordings-1', role: 'practitioner', storedOverride: grantedOverride })
  // ⚖ 9/3 named grant: the real effectiveCapabilities() chokepoint no longer
  // strips it, so the mapper DOES see it — and must still emit nothing for it,
  // because recordings.viewAll carries no LEGACY_TO_V2_TWINS entry.
  expect(input.effectiveLegacy).toContain('recordings.viewAll')
  const proposed = mapLegacyRights(input)
  expect(proposed.capabilitiesV2).toEqual([
    'customer_identity.view',
    'karute_records.view',
    'karute_records.write',
    'booking_desk.view',
    'booking_desk.manage',
  ])
})

// ─── 4. Store modes (4) ──────────────────────────────────────────────────────

const STORE_MODE_CASES = [
  {
    name: 'stores.viewAll → ALL, assignment ignored',
    role: 'senior',
    assignedStoreIds: [] as string[],
    expectMode: 'ALL' as const,
    expectStores: [] as string[],
    expectFlag: false,
  },
  {
    name: 'one assigned store → ASSIGNED, sorted',
    role: 'practitioner',
    assignedStoreIds: ['store-b'],
    expectMode: 'ASSIGNED' as const,
    expectStores: ['store-b'],
    expectFlag: false,
  },
  {
    name: 'multiple assigned stores, unsorted input → ASSIGNED, sorted output',
    role: 'practitioner',
    assignedStoreIds: ['store-c', 'store-a'],
    expectMode: 'ASSIGNED' as const,
    expectStores: ['store-a', 'store-c'],
    expectFlag: false,
  },
  {
    name: 'empty assignment (floating staff) → ALL + floating_staff_empty_assignment flag',
    role: 'practitioner',
    assignedStoreIds: [] as string[],
    expectMode: 'ALL' as const,
    expectStores: [] as string[],
    expectFlag: true,
  },
  {
    // Precedence proof: viewAll beats a REAL non-empty assignment (an empty
    // input can't distinguish "overrides" from "nothing to override").
    name: 'stores.viewAll + non-empty assignment → still ALL, assignment discarded',
    role: 'senior',
    assignedStoreIds: ['store-z', 'store-a'],
    expectMode: 'ALL' as const,
    expectStores: [] as string[],
    expectFlag: false,
  },
]

test.each(STORE_MODE_CASES)('store mode: $name', ({ role, assignedStoreIds, expectMode, expectStores, expectFlag }) => {
  executedCaseCount++
  const input = buildInput({
    subjectId: `store-${role}-${assignedStoreIds.join('_') || 'none'}`,
    role,
    assignedStoreIds,
  })
  const proposed = mapLegacyRights(input)
  expect(proposed.storeAccessMode).toBe(expectMode)
  expect(proposed.assignedStoreIds).toEqual(expectStores)
  expect(proposed.ambiguities.some((a) => a.kind === 'floating_staff_empty_assignment')).toBe(expectFlag)
})

// The mapper never emits NONE (reserved for A1 suspend flows).
test('storeAccessMode is never NONE', () => {
  executedCaseCount++
  for (const role of PERMISSION_ROLES) {
    const proposed = mapLegacyRights(buildInput({ subjectId: `never-none-${role}`, role }))
    expect(proposed.storeAccessMode).not.toBe('NONE')
  }
})

// ─── 5. Report: emptyAssignmentAudit exactness + stable sort ───────────────

test('report: rows stable-sorted by subjectId, emptyAssignmentAudit is exactly the flagged subset', () => {
  executedCaseCount++
  const roster = [
    { subjectId: 'zzz-floating', role: 'practitioner', assignedStoreIds: [] as string[] },
    { subjectId: 'aaa-assigned', role: 'practitioner', assignedStoreIds: ['store-a'] },
    { subjectId: 'mmm-viewall-empty', role: 'senior', assignedStoreIds: [] as string[] }, // viewAll, NOT floating
    { subjectId: 'bbb-floating', role: 'frontdesk', assignedStoreIds: [] as string[] },
  ]
  const rows = roster.map((r) => ({ input: buildInput(r), identity: identityFor(r.subjectId) }))
  const report = assembleMigrationReport('test-sha-0000', rows, '2026-01-01T00:00:00.000Z')

  expect(report.rows.map((r) => r.identity.subjectId)).toEqual(
    [...roster.map((r) => r.subjectId)].sort((a, b) => a.localeCompare(b)),
  )
  expect(report.emptyAssignmentAudit.map((r) => r.identity.subjectId).sort()).toEqual(
    ['bbb-floating', 'zzz-floating'].sort(),
  )
  expect(report.generatedAtIso).toBe('2026-01-01T00:00:00.000Z')
  expect(report.sourceSha).toBe('test-sha-0000')
  expect(report.presetHash).toMatch(/^[0-9a-f]{64}$/)
  expect(report.shadow.total).toBeGreaterThan(0)
  expect(report.shadow.drift).toBe(0) // every row here is a faithful mapping
})

// ─── 6. Shadow invariant — bidirectional equivalence, no drift ─────────────
// Honest scope note: compareDecisions reads the SAME LEGACY_TO_V2_TWINS table
// the mapper writes from, so these rows prove SELF-CONSISTENCY (union logic vs
// read-back), not table content. Wrong table CONTENT is caught by the
// exact-set assertions in sections 1–2, whose expected arrays are
// hand-computed independently of the table.

const SHADOW_INVARIANT_CASES: ReadonlyArray<{
  subjectId: string
  role: string
  storedOverride: ReadonlyArray<string> | null
}> = [
  ...PRESET_CASES.map((c) => ({ subjectId: `shadow-${c.role}`, role: c.role, storedOverride: null })),
  { subjectId: 'shadow-override-1', role: 'frontdesk', storedOverride: ['customers.view', 'records.write'] },
  { subjectId: 'shadow-override-2', role: 'senior', storedOverride: [] },
]

test.each(SHADOW_INVARIANT_CASES)(
  'shadow invariant holds (all match, zero drift) for $subjectId',
  ({ subjectId, role, storedOverride }) => {
    executedCaseCount++
    const input = buildInput({ subjectId, role, storedOverride })
    const proposed = mapLegacyRights(input)
    const rows = compareDecisions(input, proposed)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.status).toBe('match')
  },
)

// A deliberately WRONG `proposed` (not produced by mapLegacyRights) proves
// compareDecisions actually detects drift — the comparator is tested red,
// not assumed to work.
test('compareDecisions REPORTS drift for a deliberately wrong proposed set', () => {
  executedCaseCount++
  const input = buildInput({ subjectId: 'drift-1', role: 'frontdesk' }) // effectiveLegacy: customers.view, bookings.manage
  const badProposed: ProposedStaffRights = {
    subjectId: 'drift-1',
    provenance: 'preset',
    storeAccessMode: 'ALL',
    assignedStoreIds: [],
    // Missing customer_identity.view (customers.view's twin) AND missing
    // both bookings.manage twins; also INVENTS karute_records.delete, which
    // traces to records.delete — never held here.
    capabilitiesV2: ['karute_records.view', 'karute_records.delete'],
    perStoreCapabilitiesV2: {},
    ambiguities: [],
  }
  const rows = compareDecisions(input, badProposed)

  const byToken = new Map(rows.map((r) => [r.legacyToken, r]))
  expect(byToken.get('customers.view')?.status).toBe('drift') // held legacy, not fully mirrored in v2
  expect(byToken.get('bookings.manage')?.status).toBe('drift') // held legacy, neither twin present
  expect(byToken.get('records.write')?.status).toBe('match') // not held either side
  expect(byToken.get('records.delete')?.status).toBe('drift') // NOT held legacy, but its twin IS in v2
  expect(byToken.get('invented:karute_records.delete')?.status).toBe('drift') // invention pass

  expect(rows.filter((r) => r.status === 'drift').length).toBeGreaterThanOrEqual(3)
})

// ─── 7. Robustness / determinism ────────────────────────────────────────────

test('duplicated + reordered override/effective/store arrays → byte-identical output', () => {
  executedCaseCount++
  const canonical: LegacyRightsInput = {
    subjectId: 'dup-1',
    role: 'senior',
    storedOverride: ['customers.view', 'records.write', 'bookings.manage'],
    effectiveLegacy: ['customers.view', 'records.write', 'bookings.manage'],
    assignedStoreIds: ['store-b', 'store-a'],
    hasStoresViewAll: false,
  }
  const scrambled: LegacyRightsInput = {
    subjectId: 'dup-1',
    role: 'senior',
    storedOverride: ['records.write', 'bookings.manage', 'customers.view', 'customers.view', 'records.write'],
    effectiveLegacy: ['bookings.manage', 'customers.view', 'records.write', 'customers.view'],
    assignedStoreIds: ['store-a', 'store-b', 'store-a'],
    hasStoresViewAll: false,
  }
  expect(mapLegacyRights(scrambled)).toEqual(mapLegacyRights(canonical))
})

test('capabilitiesV2 is always in canonical CAPABILITIES_V2 declared order', () => {
  executedCaseCount++
  const proposed = mapLegacyRights(buildInput({ subjectId: 'order-1', role: 'owner' }))
  expect(proposed.capabilitiesV2).toEqual([...CAPABILITIES_V2])
})

// ─── 7b. presetHash canonicalization + report default clock ─────────────────

test('presetHash canonicalization: key/array reordering never changes the canonical JSON', () => {
  const a = canonicalRolePresetsJson({ zeta: ['b.cap', 'a.cap'], alpha: ['x.cap'] })
  const b = canonicalRolePresetsJson({ alpha: ['x.cap'], zeta: ['a.cap', 'b.cap'] })
  expect(a).toBe(b)
  // And two assemblies of the real presets agree with each other.
  const r1 = assembleMigrationReport('sha-a', [], '2026-01-01T00:00:00.000Z')
  const r2 = assembleMigrationReport('sha-b', [], '2026-01-02T00:00:00.000Z')
  expect(r1.presetHash).toBe(r2.presetHash)
})

test('assembleMigrationReport default clock produces a real ISO timestamp', () => {
  const report = assembleMigrationReport('sha-default-clock', [])
  expect(report.generatedAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

// ─── 8. Fail-closed role parse ──────────────────────────────────────────────

test('unknown role string → empty preset behavior, no crash', () => {
  executedCaseCount++
  expect(parseRoleFailClosed('not-a-real-role')).toBe('custom')
  const input = buildInput({ subjectId: 'unknown-role-1', role: 'not-a-real-role' })
  expect(input.effectiveLegacy).toEqual([])
  expect(() => mapLegacyRights(input)).not.toThrow()
  expect(mapLegacyRights(input).capabilitiesV2).toEqual([])
})

// ─── 9. Executed-count guard ─────────────────────────────────────────────────
// Registered last so it runs after every case above (Jest executes tests
// within one file serially, in declaration order).

// EXPECTED_TOTAL_CASES is a LITERAL on purpose (fresh-eyes blocker): deriving
// it from the tables' own .length made the guard self-referential — a table
// silently losing a row shrank both sides equally and stayed green. With a
// literal, ANY discovered-case shrinkage (partial or total) fails here, and
// the table-shape test below says exactly which table moved. Adding a case?
// Bump the literal — that edit is the review-visible receipt.

const EXPECTED_TOTAL_CASES = 30

test('table shapes are pinned (which table changed, when the count guard fires)', () => {
  expect(PRESET_CASES.length).toBe(6)
  expect(OVERRIDE_CASES.length).toBe(4)
  expect(STORE_MODE_CASES.length).toBe(5)
  expect(SHADOW_INVARIANT_CASES.length).toBe(8)
})

test('discovered and executed the full table-driven matrix (guards silent case shrinkage)', () => {
  expect(executedCaseCount).toBe(EXPECTED_TOTAL_CASES)
})
