// Deterministic staff color. Hash the staff id and pick from a 6-color palette
// chosen to avoid red/green/yellow (those carry status meaning in the
// appointment cards and shouldn't double-encode staff identity).
//
// Mirrors the design-spike palette referenced in the booking + dashboard
// handoffs. Promote to a per-tenant override later if a stylist wants to
// claim a specific color.

const PALETTE = [
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#d946ef', // fuchsia
]

export function getStaffColor(staffId: string | null | undefined): string | null {
  if (!staffId) return null
  let hash = 0
  for (let i = 0; i < staffId.length; i++) {
    hash = (hash * 31 + staffId.charCodeAt(i)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
