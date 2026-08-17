/**
 * @jest-environment jsdom
 *
 * Locale seam coverage (2026-08-11 packet §3, item D.3 — the blind-round's
 * "NEW coverage, en-seeded, one per seam family" list). Families with no
 * existing render-level locale assertion anywhere else in the suite:
 * AppointmentsScreen's own mount-fetch URL, DashboardScreen's own mount-fetch
 * URL, KaruteDetailScreen's mount-fetch URL AND the locale it threads into
 * its SessionProvider seed, and SettingsScreenInner's locale prop into
 * SettingsShell. Each is a behavior pin (the actual URL string / the actual
 * prop value a mocked-locale boot produces), not an implementation echo.
 *
 * Technique: mock thin/locale itself (mutable module-scope var, same idiom
 * thin-login-locale-toggle.test.tsx already uses) rather than isolateModules
 * — every screen under test reads getThinLocale() through this ONE mock, so
 * flipping mockLocale to 'en' per-test is enough; no fresh module registry
 * needed since none of these assertions touch thin/locale's OWN persistence
 * contract (that's thin-locale.test.ts's job).
 *
 * `var`, not `let`: AppointmentsScreen.tsx pulls thin/data/screen-prefetch.ts,
 * which calls getThinLocale() at MODULE TOP LEVEL to build its TARGETS array
 * — Babel hoists this file's `import`s (→ requires) above ANY other
 * top-level statement, so that call fires before a `let` binding's
 * initializer would have run (TDZ → "Cannot access before initialization").
 * `var` is hoisted with its declaration (reads as `undefined`, never throws)
 * — harmless here since nothing in this file asserts on screen-prefetch's
 * own (frozen-at-import) TARGETS array, only each screen's OWN render-time
 * getThinLocale() read, which correctly sees whatever a test set beforehand.
 */
// eslint-disable-next-line no-var -- see the doc comment above for why var (hoisting), not let, is load-bearing here
var mockLocale: 'ja' | 'en' = 'ja'
jest.mock('../../../thin/locale', () => ({
  getThinLocale: () => mockLocale,
  setThinLocale: jest.fn(),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// AppointmentsScreen → thin/data/screen-prefetch.ts statically imports
// global-recorder.ts — same two 'use server'/take-store seam stubs every
// other file touching that import chain mocks (thin-screen-prefetch.test.tsx
// precedent).
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))

// Heavy real view trees, out of scope for a URL/prop pin — same isolation
// precedent thin-screen-prefetch.test.tsx's T5 cross-pin block uses.
jest.mock('@/components/appointments/AppointmentsView', () => ({
  AppointmentsView: () => null,
}))
jest.mock('@/components/dashboard/redesign/DashboardPageView', () => ({
  DashboardPageView: () => null,
}))
jest.mock('@/components/karute/redesign/detail/KaruteDetailView', () => ({
  KaruteDetailView: () => null,
}))
jest.mock('@/components/karute/redesign/detail/PhotoRecordsCard', () => ({
  PhotoRecordsCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/AIBodyPredictionCard', () => ({
  AIBodyPredictionCard: () => null,
}))
jest.mock('@/components/karute/redesign/detail/AISuggestedMessageCard', () => ({
  AISuggestedMessageCard: () => null,
}))
jest.mock('@/components/customers/redesign/profile/UpcomingAiFeatures', () => ({
  AIBodyPredictionPreview: () => null,
  AIOutreachPreview: () => null,
}))
// The fetch-URL-only tests below never reach this (held-forever apiFetch
// keeps the screen in 'loading' state), so mocking it statically here is
// safe for them and is what the props test needs: capture what
// KaruteDetailScreen actually seeds SessionProvider's data with.
jest.mock('@/providers/session-provider', () => ({
  SessionProvider: ({ data, children }: { data: { locale: string }; children: React.ReactNode }) => (
    <div data-testid="session-locale">
      {data.locale}
      {children}
    </div>
  ),
}))
// SettingsScreenInner takes its DTO directly (no fetch) — bare stub capturing
// the one prop under test.
jest.mock('@/components/settings/redesign/SettingsShell', () => ({
  SettingsShell: ({ locale }: { locale: string }) => (
    <div data-testid="settings-locale">{locale}</div>
  ),
}))

import { render, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'
import { AppointmentsScreen } from '../../../thin/screens/AppointmentsScreen'
import { DashboardScreen } from '../../../thin/screens/DashboardScreen'
import { KaruteDetailScreen } from '../../../thin/screens/KaruteDetailScreen'
import { SettingsScreenInner } from '../../../thin/screens/SettingsScreen'
import type { SettingsScreenDTOType } from '@/lib/app-api/settings-screen-dto'

function heldForeverApiFetch() {
  return jest.fn<Promise<Response>, unknown[]>(() => new Promise<Response>(() => {}))
}

beforeEach(() => {
  mockLocale = 'ja'
  dtoCache.clear()
})

describe('AppointmentsScreen — mount-fetch URL carries the runtime locale (seam family: Appointments fetch URL)', () => {
  it('en-seeded: the mount fetch requests locale=en', async () => {
    mockLocale = 'en'
    const apiFetch = heldForeverApiFetch()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    render(<AppointmentsScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    const [path] = apiFetch.mock.calls[0]
    expect(path).toContain('locale=en')
  })
})

describe('DashboardScreen — mount-fetch URL carries the runtime locale (seam family: Dashboard fetch)', () => {
  it('en-seeded: the mount fetch requests locale=en', async () => {
    mockLocale = 'en'
    const apiFetch = heldForeverApiFetch()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    render(<DashboardScreen />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe('/api/app/v1/screens/dashboard?locale=en')
  })
})

describe('KaruteDetailScreen — mount-fetch URL carries the runtime locale (seam family: KaruteDetail fetch)', () => {
  it('en-seeded: the mount fetch requests locale=en', async () => {
    mockLocale = 'en'
    const apiFetch = heldForeverApiFetch()
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])
    render(<KaruteDetailScreen id="k1" />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())
    expect(apiFetch.mock.calls[0][0]).toBe('/api/app/v1/screens/karute/k1?locale=en')
  })
})

describe('KaruteDetailScreen — SessionProvider seed carries the runtime locale (seam family: KaruteDetail props)', () => {
  const KARUTE_DTO = {
    karuteId: 'k1',
    customerId: 'c1',
    outcome: null,
    header: {
      customerName: 'Taro Test',
      initials: 'TT',
      karuteNumber: '#00001',
      service: null,
      sessionDateLong: 'August 9, 2026',
      staffName: null,
      phone: null,
      email: null,
      age: null,
      gender: null,
      visitNumber: null,
      lastVisitDate: null,
    },
    sessionDateLong: 'August 9, 2026',
    sessionDateIso: null,
    entries: [],
    summaryBullets: [],
    transcript: null,
    consentOnFile: false,
    transcriptDurationLabel: null,
    transcriptRestricted: false,
    photos: [],
    viewerRole: 'practitioner',
  }

  function jsonResponse(body: unknown): Response {
    return { ok: true, json: async () => body } as unknown as Response
  }

  it('en-seeded: the SessionProvider data seed carries locale "en", not the ja default', async () => {
    mockLocale = 'en'
    const apiFetch = jest.fn(async () => jsonResponse(KARUTE_DTO))
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    const { findByTestId } = render(<KaruteDetailScreen id="k1" />)
    const el = await findByTestId('session-locale')
    expect(el.textContent).toContain('en')
  })
})

describe('SettingsScreenInner — locale prop carries the runtime locale into SettingsShell (seam family: Settings prop)', () => {
  const SETTINGS_DTO: SettingsScreenDTOType = {
    orgSettings: null,
    staffList: [],
    activeStaffId: null,
    isOwner: true,
    canViewAllStores: true,
    canManageStaff: true,
    canInviteStaff: true,
    canViewAudit: true,
    canViewSync: true,
    // false keeps this fixture's rendered tab set unchanged — the メニュー tab
    // has its own pin in thin-settings-sync-webonly-mount.test.tsx.
    canManageMenus: false,
    syncStatus: null,
    initialTab: null,
    auditTargetId: null,
    initialActiveStoreId: null,
    initialStores: [],
    initialEntitlement: null,
    featureStaffInvites: false,
    featureMultiStore: false,
    serviceNoun: '施術',
  }

  it('en-seeded: SettingsShell receives locale="en", not the ja default', () => {
    mockLocale = 'en'
    const { getByTestId } = render(<SettingsScreenInner dto={SETTINGS_DTO} />)
    expect(getByTestId('settings-locale').textContent).toBe('en')
  })
})
