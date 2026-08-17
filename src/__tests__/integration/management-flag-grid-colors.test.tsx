/** @jest-environment jsdom */
/**
 * ReservationGrid palette wiring (PR B, fix round B6).
 *
 * `assignStaffColors` hands out hues by SORTED POSITION, so whatever array the
 * grid feeds it decides everyone's color. Once the 経営メンバー rule started
 * shortening the lane list, coloring over `staff` meant an idle management
 * member silently re-hued every lane below them — for that one day only, so it
 * reads as the app randomly repainting the salon.
 *
 * `colorRosterIds` (the store roster, one level up from the lanes) is the fix.
 * These pins are on the WIRING: that the prop is what drives the hue, and that
 * omitting it still renders the way it always did.
 */
import { render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}))

import { ReservationGrid } from '@/components/reservation/ReservationGrid'
import { assignStaffColors, getStaffColorByKey } from '@/lib/staff-colors'
import type { ReservationStaff } from '@/components/reservation/StaffRow'

// Sorted order is the assignment order, so these ids map to palette slots 0..3.
const ROSTER_IDS = ['p-1', 'p-2', 'p-3', 'p-4']

function lane(id: string, initials: string): ReservationStaff {
  return { id, name: `staff ${id}`, role: '', takesBookings: true, initials }
}

const HOURS = { start: 10, end: 12 }

/** The avatar div carries the hue classes (color.bg + color.text). */
function avatarClasses(initials: string): string {
  return screen.getByText(initials).className
}

function expectedBg(rosterIds: readonly string[], id: string): string {
  return getStaffColorByKey(assignStaffColors(rosterIds).get(id)?.key).bg
}

describe('ReservationGrid — hue follows colorRosterIds, not the lane list', () => {
  it('a lone remaining lane keeps its FULL-store hue, not slot 0', () => {
    // Only p-4 has a lane today; the other three are hidden 経営メンバー.
    render(
      <ReservationGrid
        staff={[lane('p-4', 'D')]}
        reservations={[]}
        businessHours={HOURS}
        colorRosterIds={ROSTER_IDS}
      />,
    )
    const cls = avatarClasses('D')
    expect(cls).toContain(expectedBg(ROSTER_IDS, 'p-4'))
    // The bug this pins: colored over the lane list, p-4 would take slot 0.
    expect(expectedBg(ROSTER_IDS, 'p-4')).not.toBe(expectedBg(['p-4'], 'p-4'))
    expect(cls).not.toContain(expectedBg(['p-4'], 'p-4'))
  })

  it('hues are stable as lanes disappear — the surviving lane never repaints', () => {
    const { unmount } = render(
      <ReservationGrid
        staff={ROSTER_IDS.map((id, i) => lane(id, String(i)))}
        reservations={[]}
        businessHours={HOURS}
        colorRosterIds={ROSTER_IDS}
      />,
    )
    const before = avatarClasses('3')
    unmount()

    render(
      <ReservationGrid
        staff={[lane('p-4', '3')]}
        reservations={[]}
        businessHours={HOURS}
        colorRosterIds={ROSTER_IDS}
      />,
    )
    expect(avatarClasses('3')).toBe(before)
  })

  it('fallback: no colorRosterIds still renders, colored over the lanes', () => {
    render(
      <ReservationGrid staff={[lane('p-4', 'D')]} reservations={[]} businessHours={HOURS} />,
    )
    expect(screen.getByText('staff p-4')).toBeTruthy()
    expect(avatarClasses('D')).toContain(expectedBg(['p-4'], 'p-4'))
  })

  it('an EMPTY colorRosterIds takes the fallback too (DTO default on a skewed bundle)', () => {
    render(
      <ReservationGrid
        staff={[lane('p-4', 'D')]}
        reservations={[]}
        businessHours={HOURS}
        colorRosterIds={[]}
      />,
    )
    expect(avatarClasses('D')).toContain(expectedBg(['p-4'], 'p-4'))
  })
})
