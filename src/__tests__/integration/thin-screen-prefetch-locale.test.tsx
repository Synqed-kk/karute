/**
 * @jest-environment jsdom
 *
 * thin/data/screen-prefetch.ts — locale wiring (2026-08-11 packet). The
 * existing byte-pin suite (thin-screen-prefetch.test.tsx) already proves the
 * ja-default shape stays exact; this file proves the OTHER half — that
 * PREFETCH_PATHS and recordWarmPath actually read thin/locale.ts's
 * getThinLocale() rather than a re-hardcoded literal — via a fresh isolated
 * module registry with `thin.locale` pre-set to 'en' before screen-prefetch
 * ever loads (TARGETS is a module-top-level const, built once at import).
 *
 * Same two 'use server'/take-store seam mocks thin-screen-prefetch.test.tsx
 * carries: screen-prefetch.ts statically imports @/lib/global-recorder,
 * which pulls @/actions/recordings + @/lib/karute/take-store.
 */
jest.mock('@/actions/recordings', () => ({ startRecordingSession: jest.fn() }))
jest.mock('@/lib/karute/take-store', () => ({
  appendTakeSegment: jest.fn(),
  createTake: jest.fn(),
  deleteTake: jest.fn(),
  stampTakeSession: jest.fn(),
}))
// ScreenBoundary.tsx (imported transitively for cacheDto/dtoCache) calls
// useTranslations at module scope in two unmounted helper components — real
// next-intl is ESM and jest's transformIgnorePatterns allow-list doesn't
// reach it through jest.isolateModulesAsync's dynamic import path, so stub
// it the same way thin-screen-prefetch.test.tsx does for its own render harness.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

beforeEach(() => {
  jest.resetModules()
  window.localStorage.clear()
})

async function loadScreenPrefetch() {
  let mod!: typeof import('../../../thin/data/screen-prefetch')
  await jest.isolateModulesAsync(async () => {
    mod = await import('../../../thin/data/screen-prefetch')
  })
  return mod
}

describe('screen-prefetch URLs carry the module locale', () => {
  it('ja default: PREFETCH_PATHS and recordWarmPath stay locale=ja (unchanged from the byte-pin suite)', async () => {
    const { PREFETCH_PATHS, recordWarmPath } = await loadScreenPrefetch()
    expect(PREFETCH_PATHS[0]).toBe('/api/app/v1/screens/record?locale=ja')
    expect(PREFETCH_PATHS[1]).toBe('/api/app/v1/screens/appointments?locale=ja')
    expect(recordWarmPath('a1')).toBe(
      '/api/app/v1/screens/record?appointmentId=a1&locale=ja',
    )
  })

  it('en selected at boot: PREFETCH_PATHS and recordWarmPath carry locale=en', async () => {
    window.localStorage.setItem('thin.locale', 'en')
    const { PREFETCH_PATHS, recordWarmPath } = await loadScreenPrefetch()
    expect(PREFETCH_PATHS[0]).toBe('/api/app/v1/screens/record?locale=en')
    expect(PREFETCH_PATHS[1]).toBe('/api/app/v1/screens/appointments?locale=en')
    expect(recordWarmPath('a1')).toBe(
      '/api/app/v1/screens/record?appointmentId=a1&locale=en',
    )
  })
})
