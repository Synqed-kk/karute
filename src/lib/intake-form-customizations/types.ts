// ─────────────────────────────────────────────────────────────
// Intake-form customizations — types
// ─────────────────────────────────────────────────────────────
// LIFTED FROM SPIKE: src/lib/intake-form-customizations.ts
// Owners can ADD custom intake fields to any section, plus HIDE
// Synqed-recommended base fields they don't use. Customizations
// layer on top of a business-type base profile.

export type IntakeSectionKey =
  /** What the customer is dealing with — pain, skin concerns, etc. */
  | 'symptoms'
  /** Posture / alignment questions (relevant for chiro / massage). */
  | 'posture'
  /** Beauty-side questions (skin type, makeup preferences, etc.). */
  | 'beauty'
  /** What outcome the customer wants from coming in. */
  | 'goals'

export interface IntakeCustomField {
  id: string
  labelJa: string
  labelEn: string
  /** ISO when the owner added this field. */
  addedAt: string
}

/** Per-section customization data — custom fields owners added,
 *  plus base labels they've explicitly hidden. */
export interface IntakeCustomizations {
  customFields: Record<IntakeSectionKey, IntakeCustomField[]>
  /** Labels of Synqed-base fields the owner has hidden. Stored as
   *  the original label string (JA) so adding/removing a base
   *  field in our seed list survives. */
  hiddenBase: Record<IntakeSectionKey, string[]>
}

export const EMPTY_CUSTOMIZATIONS: IntakeCustomizations = {
  customFields: {
    symptoms: [],
    posture: [],
    beauty: [],
    goals: [],
  },
  hiddenBase: {
    symptoms: [],
    posture: [],
    beauty: [],
    goals: [],
  },
}

export const INTAKE_SECTION_KEYS: readonly IntakeSectionKey[] = [
  'symptoms',
  'posture',
  'beauty',
  'goals',
]
