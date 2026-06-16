// Single source for the visit-SEGMENT → Tailwind color mapping. The semantic
// role (success/neutral/warning/info) is decided ONCE in the helper
// (SEGMENT_TONE); this maps each role to the chip / tactic-strip classes so the
// chip, the tactic strip, and the rhythm panel can never drift in color. Matches
// the green/amber/blue/muted conventions already used on CustomerIdentityCard.

import { SEGMENT_TONE, type VisitSegment } from '@/lib/visits/segment'

export type SegmentToneRole = 'success' | 'neutral' | 'warning' | 'info'

export function segmentToneRole(segment: VisitSegment): SegmentToneRole {
  return SEGMENT_TONE[segment]
}

/** Pill / chip — bordered, light fill. */
export const CHIP_CLASS: Record<SegmentToneRole, string> = {
  success:
    'border-green-200 bg-green-50 text-green-700 dark:border-green-500/20 dark:bg-green-500/10 dark:text-green-300',
  neutral: 'border-border bg-muted text-muted-foreground',
  warning:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300',
  info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300',
}

/** Tactic strip — soft tinted block (no border), darker text. */
export const STRIP_CLASS: Record<SegmentToneRole, string> = {
  success: 'bg-green-50 text-green-800 dark:bg-green-500/10 dark:text-green-200',
  neutral: 'bg-muted text-foreground',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200',
  info: 'bg-blue-50 text-blue-800 dark:bg-blue-500/10 dark:text-blue-200',
}

/** Tactic-strip leading icon — the tone's mid color. */
export const STRIP_ICON_CLASS: Record<SegmentToneRole, string> = {
  success: 'text-green-600 dark:text-green-400',
  neutral: 'text-muted-foreground',
  warning: 'text-amber-600 dark:text-amber-400',
  info: 'text-blue-600 dark:text-blue-400',
}

/** Rhythm bar fill — sage on-rhythm, amber once drifting. */
export const RHYTHM_FILL_CLASS = {
  onRhythm: 'bg-green-400 dark:bg-green-500/60',
  over: 'bg-amber-400 dark:bg-amber-500/70',
} as const
