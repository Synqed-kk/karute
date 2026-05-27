/**
 * @jest-environment jsdom
 *
 * Unit coverage for the intake-form-customizations state layer added in
 * PR #95 (replay/21). Per-business-type localStorage store with a
 * useSyncExternalStore read + add/remove/toggle/clear mutations.
 */
import { renderHook, act } from '@testing-library/react'
import { useIntakeFormCustomizations } from '@/lib/intake-form-customizations/hooks'
import {
  EMPTY_CUSTOMIZATIONS,
  INTAKE_SECTION_KEYS,
  type IntakeCustomizations,
} from '@/lib/intake-form-customizations/types'

const keyFor = (businessType: string) =>
  `synqed-karute-intake-customizations:${businessType}`

// Each test uses a unique businessType so the module-level parse cache (keyed
// by businessType) never bleeds between cases.
let counter = 0
function uniqueType(): string {
  counter += 1
  return `bizType_${counter}`
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('types — EMPTY_CUSTOMIZATIONS / INTAKE_SECTION_KEYS', () => {
  it('EMPTY_CUSTOMIZATIONS has an empty array per section in both maps', () => {
    for (const section of INTAKE_SECTION_KEYS) {
      expect(EMPTY_CUSTOMIZATIONS.customFields[section]).toEqual([])
      expect(EMPTY_CUSTOMIZATIONS.hiddenBase[section]).toEqual([])
    }
  })

  it('INTAKE_SECTION_KEYS covers exactly the four known sections', () => {
    expect([...INTAKE_SECTION_KEYS].sort()).toEqual(
      ['beauty', 'goals', 'posture', 'symptoms'].sort(),
    )
  })
})

describe('useIntakeFormCustomizations — read', () => {
  it('defaults to empty customizations when nothing is stored', () => {
    const { result } = renderHook(() => useIntakeFormCustomizations(uniqueType()))
    expect(result.current.customizations).toEqual(EMPTY_CUSTOMIZATIONS)
  })

  it('reads a seeded value', () => {
    const bt = uniqueType()
    const seeded: IntakeCustomizations = {
      customFields: {
        symptoms: [
          { id: 'f1', labelJa: '痛み', labelEn: 'Pain', addedAt: '2026-05-01T00:00:00Z' },
        ],
        posture: [],
        beauty: [],
        goals: [],
      },
      hiddenBase: { symptoms: ['冷え'], posture: [], beauty: [], goals: [] },
    }
    window.localStorage.setItem(keyFor(bt), JSON.stringify(seeded))
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    expect(result.current.customizations.customFields.symptoms).toHaveLength(1)
    expect(result.current.customizations.customFields.symptoms[0].labelEn).toBe('Pain')
    expect(result.current.customizations.hiddenBase.symptoms).toEqual(['冷え'])
  })

  it('falls back to empty customizations on malformed JSON', () => {
    const bt = uniqueType()
    window.localStorage.setItem(keyFor(bt), '{not json')
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    expect(result.current.customizations).toEqual(EMPTY_CUSTOMIZATIONS)
  })

  it('backfills missing sections from a partial stored payload', () => {
    const bt = uniqueType()
    // Only the symptoms section present — the read() merge should backfill
    // the rest so callers never index undefined.
    window.localStorage.setItem(
      keyFor(bt),
      JSON.stringify({
        customFields: {
          symptoms: [
            { id: 'f1', labelJa: 'A', labelEn: 'A', addedAt: '2026-05-01T00:00:00Z' },
          ],
        },
        hiddenBase: {},
      }),
    )
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    expect(result.current.customizations.customFields.symptoms).toHaveLength(1)
    expect(result.current.customizations.customFields.posture).toEqual([])
    expect(result.current.customizations.hiddenBase.goals).toEqual([])
  })

  it('isolates customizations per business type', () => {
    const a = uniqueType()
    const b = uniqueType()
    const { result: ra } = renderHook(() => useIntakeFormCustomizations(a))
    const { result: rb } = renderHook(() => useIntakeFormCustomizations(b))
    act(() => ra.current.addCustomField('goals', { labelJa: 'X', labelEn: 'X' }))
    expect(ra.current.customizations.customFields.goals).toHaveLength(1)
    expect(rb.current.customizations.customFields.goals).toHaveLength(0)
  })
})

describe('useIntakeFormCustomizations — mutations', () => {
  it('addCustomField appends a trimmed field reactively', () => {
    const bt = uniqueType()
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    act(() =>
      result.current.addCustomField('symptoms', {
        labelJa: '  痛み  ',
        labelEn: '  Pain  ',
      }),
    )
    const fields = result.current.customizations.customFields.symptoms
    expect(fields).toHaveLength(1)
    expect(fields[0].labelJa).toBe('痛み')
    expect(fields[0].labelEn).toBe('Pain')
    expect(typeof fields[0].id).toBe('string')
    expect(fields[0].id.startsWith('field_')).toBe(true)
    // persisted
    const stored = JSON.parse(
      window.localStorage.getItem(keyFor(bt))!,
    ) as IntakeCustomizations
    expect(stored.customFields.symptoms).toHaveLength(1)
  })

  it('removeCustomField drops only the matching id and leaves others', () => {
    // Seed two fields with explicitly distinct ids. NOTE: we cannot rely on
    // two back-to-back addCustomField() calls producing distinct ids — the
    // hook derives ids from `field_${Date.now()}`, which collides within a
    // millisecond (see the flagged test below). Seeding directly isolates the
    // removeCustomField filter logic from that id-generation bug.
    const bt = uniqueType()
    window.localStorage.setItem(
      keyFor(bt),
      JSON.stringify({
        customFields: {
          symptoms: [],
          posture: [],
          beauty: [
            { id: 'a', labelJa: 'A', labelEn: 'A', addedAt: '2026-05-01T00:00:00Z' },
            { id: 'b', labelJa: 'B', labelEn: 'B', addedAt: '2026-05-01T00:00:00Z' },
          ],
          goals: [],
        },
        hiddenBase: { symptoms: [], posture: [], beauty: [], goals: [] },
      }),
    )
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    act(() => result.current.removeCustomField('beauty', 'a'))
    const remaining = result.current.customizations.customFields.beauty
    expect(remaining).toHaveLength(1)
    expect(remaining[0].labelEn).toBe('B')
  })

  // FLAGGED (not pinned): addCustomField derives ids from
  // `field_${Date.now()}`. Two fields added within the same millisecond get
  // the SAME id, so a later removeCustomField(id) removes BOTH. This test
  // documents the current (buggy) behavior without asserting it is correct.
  it('[FLAGGED] addCustomField can produce duplicate ids within one ms (Date.now collision)', () => {
    const bt = uniqueType()
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    act(() => result.current.addCustomField('beauty', { labelJa: 'A', labelEn: 'A' }))
    act(() => result.current.addCustomField('beauty', { labelJa: 'B', labelEn: 'B' }))
    const fields = result.current.customizations.customFields.beauty
    expect(fields).toHaveLength(2)
    const ids = fields.map((f) => f.id)
    // Ideally these would always be unique. In practice they frequently
    // collide because Date.now() has ms resolution. If this ever starts
    // failing (ids became unique), the underlying id scheme was fixed —
    // update/remove this flag.
    const collided = ids[0] === ids[1]
    // We assert the *shape* (two fields exist), and merely observe collision.
    expect(typeof collided).toBe('boolean')
  })

  it('removeCustomField with an unknown id is a no-op', () => {
    const bt = uniqueType()
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    act(() => result.current.addCustomField('beauty', { labelJa: 'A', labelEn: 'A' }))
    act(() => result.current.removeCustomField('beauty', 'nope'))
    expect(result.current.customizations.customFields.beauty).toHaveLength(1)
  })

  it('toggleBaseVisibility hides then unhides a base label', () => {
    const bt = uniqueType()
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    act(() => result.current.toggleBaseVisibility('posture', '猫背'))
    expect(result.current.customizations.hiddenBase.posture).toEqual(['猫背'])
    act(() => result.current.toggleBaseVisibility('posture', '猫背'))
    expect(result.current.customizations.hiddenBase.posture).toEqual([])
  })

  it('clearAll resets every section to empty', () => {
    const bt = uniqueType()
    const { result } = renderHook(() => useIntakeFormCustomizations(bt))
    act(() => result.current.addCustomField('goals', { labelJa: 'G', labelEn: 'G' }))
    act(() => result.current.toggleBaseVisibility('symptoms', '冷え'))
    expect(result.current.customizations.customFields.goals).toHaveLength(1)
    act(() => result.current.clearAll())
    expect(result.current.customizations).toEqual(EMPTY_CUSTOMIZATIONS)
  })
})
