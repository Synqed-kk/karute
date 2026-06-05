// ───────────────────────────────────────────────────────────────────────────
// Staff colors — mirrors the design spike (src/lib/staff-colors.ts).
//
// Each staff member gets a SUBTLE color, used consistently across the
// reservation agenda, customer list, karute list, dashboard, recording picker:
//   - `bg` + `text`  → the initials avatar / chip: a LIGHT tinted background
//                       with DARK legible text (NOT a vivid fill + white text).
//   - `stripe`        → the SOLID hue for the 担当 dot + the customer-card
//                       left-edge stripe.
//   - `ring`          → subtle border.
// All are Tailwind classes with `dark:` variants, so they adapt to dark mode.
//
// ASSIGNMENT IS DISTINCT, NOT HASHED. `assignStaffColors(roster)` sorts the
// unique staff ids and hands out palette colors by position, so two staff
// NEVER share a color (until the roster outgrows the palette, which wraps).
// Feed it the FULL salon roster (getStaffList) so the mapping is identical on
// every page. The old `% PALETTE.length` hash collided — that was the "two
// staff share pink" bug.
//
// Palette avoids red / green / amber / gray — those carry status meaning
// (予約済 / 完了 / 更新案内 / 施術中) elsewhere in the UI.
// ───────────────────────────────────────────────────────────────────────────

export const STAFF_COLOR_KEYS = [
  'blue',
  'violet',
  'teal',
  'pink',
  'cyan',
  'fuchsia',
  'indigo',
  'rose',
] as const

export type StaffColorKey = (typeof STAFF_COLOR_KEYS)[number]

export interface StaffColor {
  key: StaffColorKey | 'neutral'
  /** Solid hue — the 担当 dot + the customer-card left stripe. */
  stripe: string
  /** Light tinted background for the initials avatar / chip. */
  bg: string
  /** Dark, legible text for the avatar initials. */
  text: string
  /** Subtle ring/border. */
  ring: string
}

const PALETTE: Record<StaffColorKey, StaffColor> = {
  blue: {
    key: 'blue',
    stripe: 'bg-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-500/15',
    text: 'text-blue-800 dark:text-blue-200',
    ring: 'ring-blue-200/70 dark:ring-blue-500/30',
  },
  violet: {
    key: 'violet',
    stripe: 'bg-violet-500',
    bg: 'bg-violet-50 dark:bg-violet-500/15',
    text: 'text-violet-800 dark:text-violet-200',
    ring: 'ring-violet-200/70 dark:ring-violet-500/30',
  },
  teal: {
    key: 'teal',
    stripe: 'bg-teal-500',
    bg: 'bg-teal-50 dark:bg-teal-500/15',
    text: 'text-teal-800 dark:text-teal-200',
    ring: 'ring-teal-200/70 dark:ring-teal-500/30',
  },
  pink: {
    key: 'pink',
    stripe: 'bg-pink-500',
    bg: 'bg-pink-50 dark:bg-pink-500/15',
    text: 'text-pink-800 dark:text-pink-200',
    ring: 'ring-pink-200/70 dark:ring-pink-500/30',
  },
  cyan: {
    key: 'cyan',
    stripe: 'bg-cyan-500',
    bg: 'bg-cyan-50 dark:bg-cyan-500/15',
    text: 'text-cyan-800 dark:text-cyan-200',
    ring: 'ring-cyan-200/70 dark:ring-cyan-500/30',
  },
  fuchsia: {
    key: 'fuchsia',
    stripe: 'bg-fuchsia-500',
    bg: 'bg-fuchsia-50 dark:bg-fuchsia-500/15',
    text: 'text-fuchsia-800 dark:text-fuchsia-200',
    ring: 'ring-fuchsia-200/70 dark:ring-fuchsia-500/30',
  },
  indigo: {
    key: 'indigo',
    stripe: 'bg-indigo-500',
    bg: 'bg-indigo-50 dark:bg-indigo-500/15',
    text: 'text-indigo-800 dark:text-indigo-200',
    ring: 'ring-indigo-200/70 dark:ring-indigo-500/30',
  },
  rose: {
    key: 'rose',
    stripe: 'bg-rose-500',
    bg: 'bg-rose-50 dark:bg-rose-500/15',
    text: 'text-rose-800 dark:text-rose-200',
    ring: 'ring-rose-200/70 dark:ring-rose-500/30',
  },
}

/** Greyed-out fallback for staff-less rows — NOT a palette color. */
export const NEUTRAL_STAFF_COLOR: StaffColor = {
  key: 'neutral',
  stripe: 'bg-slate-300 dark:bg-slate-600',
  bg: 'bg-muted',
  text: 'text-muted-foreground',
  ring: 'ring-border',
}

export function getStaffColorByKey(
  key: StaffColorKey | 'neutral' | null | undefined,
): StaffColor {
  if (!key || key === 'neutral') return NEUTRAL_STAFF_COLOR
  return PALETTE[key] ?? NEUTRAL_STAFF_COLOR
}

/**
 * DISTINCT staff-color map. Sorts the unique staff ids and assigns the i-th
 * palette color — no two staff ever share a color. Pass the FULL roster
 * (getStaffList output) so the mapping is identical on every surface.
 */
export function assignStaffColors(
  staffIds: ReadonlyArray<string | null | undefined>,
): Map<string, StaffColor> {
  const unique = [...new Set(staffIds.filter((id): id is string => !!id))].sort()
  const map = new Map<string, StaffColor>()
  unique.forEach((id, i) => {
    map.set(id, PALETTE[STAFF_COLOR_KEYS[i % STAFF_COLOR_KEYS.length]])
  })
  return map
}
