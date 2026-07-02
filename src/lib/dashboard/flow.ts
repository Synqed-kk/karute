// Pure derivations for the dashboard flow (hero pick, todo list, note/summary
// cleaning). No IO — everything here is unit-testable with plain objects.

import type { DashboardTodayAppointment } from './cached'

export interface HeroSlide {
  appointment: DashboardTodayAppointment
  inProgress: boolean
}

/** Upcoming (or in-progress) appointments that don't have a karute yet,
 *  soonest first — the hero carousel. Slide 1 is "next customer"; the rest
 *  are the swipe-peek. A recorded session is done regardless of the clock. */
export function pickHeroSlides(
  appointments: DashboardTodayAppointment[],
  now: Date,
  max = 3,
): HeroSlide[] {
  return appointments
    .filter((a) => {
      if (a.karute_record_id) return false
      const start = new Date(a.start_time).getTime()
      const end = start + a.duration_minutes * 60_000
      return end > now.getTime()
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
    .slice(0, max)
    .map((a) => ({
      appointment: a,
      inProgress: new Date(a.start_time).getTime() <= now.getTime(),
    }))
}

/** Sessions that ENDED without a karute — the 録音 todo. Soonest-ended first
 *  so the oldest miss is at the top. */
export function pickKaruteTodos(
  appointments: DashboardTodayAppointment[],
  now: Date,
): DashboardTodayAppointment[] {
  return appointments
    .filter((a) => {
      if (a.karute_record_id) return false
      const end = new Date(a.start_time).getTime() + a.duration_minutes * 60_000
      return end <= now.getTime()
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time))
}

/** The customer's booking request, without the QR plumbing. Notes arrive as
 *  「QR #340546 | 肩こり 頭痛」— staff need the complaint, not the reference. */
export function cleanRequestNote(notes: string | null): string | null {
  if (!notes) return null
  const cleaned = notes
    .replace(/QR\s*#[\d０-９]+\s*[|｜]?/gi, '')
    .replace(/^[\s|｜]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 0 ? cleaned : null
}

/** One display line from an AI summary. Handles the three shapes in prod
 *  data: plain text, bullet lists (・…), and a JSON blob that leaked into
 *  ai_summary ({"summary":"…"}). */
export function summaryLine(raw: string | null): string | null {
  if (!raw) return null
  let s = raw.trim()
  if (s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s) as { summary?: unknown }
      if (typeof parsed.summary === 'string') s = parsed.summary
    } catch {
      /* not JSON after all — keep raw */
    }
  }
  const firstLine = s
    .split('\n')
    .map((l) => l.replace(/^[・\-*\s]+/, '').trim())
    .find((l) => l.length > 0)
  return firstLine && firstLine.length > 0 ? firstLine : null
}

export type VisitRound =
  | { kind: 'first' }
  | { kind: 'nth'; n: number }
  | { kind: 'repeat' }

/** What today's visit is, for the hero tag: 初回 / n回目 / リピーター (returning
 *  but we don't know the count). visitCount = completed past visits. */
export function visitRound(visitCount: number, returning: boolean): VisitRound {
  if (!returning) return { kind: 'first' }
  if (visitCount > 0) return { kind: 'nth', n: visitCount + 1 }
  return { kind: 'repeat' }
}
