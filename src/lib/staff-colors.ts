/**
 * Deterministic staff-color assignment.
 *
 * Maps any staff id (typically a UUID) to a stable {bg, border, accent, text}
 * tuple drawn from a 6-color palette: blue / violet / teal / pink / cyan /
 * fuchsia. Palette intentionally avoids red / green / yellow, which carry
 * status meaning (新規 / 完了 / 未確定) elsewhere in the reservation UI.
 *
 * Hash: FNV-1a 32-bit. Bucket = hash mod palette.length.
 */

export const STAFF_COLOR_KEYS = [
  'blue',
  'violet',
  'teal',
  'pink',
  'cyan',
  'fuchsia',
] as const

export type StaffColorKey = (typeof STAFF_COLOR_KEYS)[number]

export interface StaffColor {
  key: StaffColorKey
  bg: string
  border: string
  accent: string
  text: string
}

const PALETTE: Record<StaffColorKey, StaffColor> = {
  blue: {
    key: 'blue',
    bg: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.30)',
    accent: '#3b82f6',
    text: '#1d4ed8',
  },
  violet: {
    key: 'violet',
    bg: 'rgba(139, 92, 246, 0.14)',
    border: 'rgba(139, 92, 246, 0.32)',
    accent: '#8b5cf6',
    text: '#6d28d9',
  },
  teal: {
    key: 'teal',
    bg: 'rgba(20, 184, 166, 0.14)',
    border: 'rgba(20, 184, 166, 0.32)',
    accent: '#14b8a6',
    text: '#0f766e',
  },
  pink: {
    key: 'pink',
    bg: 'rgba(236, 72, 153, 0.14)',
    border: 'rgba(236, 72, 153, 0.32)',
    accent: '#ec4899',
    text: '#be185d',
  },
  cyan: {
    key: 'cyan',
    bg: 'rgba(6, 182, 212, 0.14)',
    border: 'rgba(6, 182, 212, 0.32)',
    accent: '#06b6d4',
    text: '#0e7490',
  },
  fuchsia: {
    key: 'fuchsia',
    bg: 'rgba(217, 70, 239, 0.14)',
    border: 'rgba(217, 70, 239, 0.32)',
    accent: '#d946ef',
    text: '#a21caf',
  },
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

export function getStaffColor(staffId: string): StaffColor {
  const bucket = fnv1a32(staffId) % STAFF_COLOR_KEYS.length
  return PALETTE[STAFF_COLOR_KEYS[bucket]]
}
