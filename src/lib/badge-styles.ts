// ───────────────────────────────────────────────────────────────────────────
// Badge styling — SINGLE SOURCE OF TRUTH for every status badge in the app.
//
// Liam's call (2026-06-03): the customer-record badge style is the canonical
// one — a light tinted bg + dark text + subtle border (NOT see-through ring
// pills, NOT solid-fill + white text). Every badge across the system (customer
// status, reservation status, dashboard, etc.) maps its status → a color key
// here and renders `bg + text + border`, so they all look identical.
//
// To add a status color anywhere: add the color here and reference it. Do NOT
// hand-roll bg/text/border classes in a component — that's how the system
// drifted out of sync in the first place.
// ───────────────────────────────────────────────────────────────────────────

export interface BadgeStyle {
  /** Light tinted background (the badge fill). */
  bg: string
  /** Dark, legible text — light-mode-safe (700) + dark-mode (300). */
  text: string
  /** Subtle border. */
  border: string
  /** Solid accent — for left stripes + legend/count dots. */
  solid: string
}

export const BADGE_COLORS = {
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-500/20',
    solid: 'bg-blue-500',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-500/10',
    text: 'text-green-700 dark:text-green-300',
    border: 'border-green-200 dark:border-green-500/20',
    solid: 'bg-green-500',
  },
  orange: {
    bg: 'bg-orange-50 dark:bg-orange-500/10',
    text: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-200 dark:border-orange-500/20',
    solid: 'bg-orange-500',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-500/10',
    text: 'text-amber-800 dark:text-amber-300',
    border: 'border-amber-200 dark:border-amber-500/30',
    solid: 'bg-amber-500',
  },
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-500/10',
    text: 'text-yellow-800 dark:text-yellow-300',
    border: 'border-yellow-300 dark:border-yellow-500/30',
    solid: 'bg-yellow-500',
  },
  red: {
    bg: 'bg-red-50 dark:bg-red-500/10',
    text: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-500/20',
    solid: 'bg-red-500',
  },
  slate: {
    bg: 'bg-slate-100 dark:bg-slate-500/10',
    text: 'text-slate-600 dark:text-slate-300',
    border: 'border-slate-200 dark:border-slate-500/20',
    solid: 'bg-slate-400 dark:bg-slate-500',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-500/10',
    text: 'text-violet-700 dark:text-violet-300',
    border: 'border-violet-200 dark:border-violet-500/20',
    solid: 'bg-violet-500',
  },
} as const satisfies Record<string, BadgeStyle>

export type BadgeColor = keyof typeof BADGE_COLORS

/** Convenience: the three badge classes joined, for `className={badge('green')}`. */
export function badge(color: BadgeColor): string {
  const c = BADGE_COLORS[color]
  return `${c.bg} ${c.text} ${c.border}`
}
