/**
 * @jest-environment jsdom
 *
 * Round 3 leg 1 (2026-09-24, D-S19-2, lead) — THE REMOVED SCREEN the (app)
 * layout renders when getBusinessId refuses the session with
 * membership_inactive: the gate layout with its own words and SIGN-OUT ONLY —
 * no recheck button, no auto-reload (removal is a fact a reload cannot change).
 * The outage screen's recheck button is pinned in store-outage-screen.test.tsx.
 */
import { act, render, screen } from '@testing-library/react'
import ja from '@/../messages/ja.json'
import en from '@/../messages/en.json'

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    return messages[ns]?.[key] ?? key
  },
  useLocale: () => 'ja',
}))
jest.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: jest.fn() } }) }))
jest.mock('@/lib/karute/logout-wipe', () => ({ wipeSessionVault: jest.fn(async () => {}) }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

import { RemovedStaffScreen } from '@/components/layout/RemovedStaffScreen'
import { StoreGateScreen } from '@/components/layout/UnassignedStoreScreen'

const originalLocation = window.location
const reload = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  reload.mockClear()
  Object.defineProperty(window, 'location', { configurable: true, value: { reload } })
})
afterEach(() => {
  jest.useRealTimers()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

it('P5 says what happened and offers ONE action — sign out; no recheck button', () => {
  render(<RemovedStaffScreen />)
  expect(screen.getByRole('heading', { name: ja.removedStaff.title })).toBeInTheDocument()
  expect(screen.getByText(ja.removedStaff.body)).toBeInTheDocument()
  expect(screen.getAllByRole('button')).toHaveLength(1)
  expect(screen.getByRole('button', { name: ja.removedStaff.logout })).toBeInTheDocument()
})

it('P5 never reloads on its own', () => {
  render(<RemovedStaffScreen />)
  act(() => jest.advanceTimersByTime(10 * 60_000))
  expect(reload).not.toHaveBeenCalled()
})

it('StoreGateScreen copy: recheck + rechecking are a pair or absent (tsc refuses a lopsided pair)', () => {
  const lopsided = (
    // @ts-expect-error — a recheck without its busy label would render an unlabeled button (Greptile P2, #1028)
    <StoreGateScreen copy={{ title: 't', body: 'b', recheck: 'r', logout: 'l' }} />
  )
  expect(lopsided).toBeTruthy()
})

it('catalogue: ja/en carry the same three keys; logout matches the unassigned screen', () => {
  expect(Object.keys(ja.removedStaff)).toEqual(['title', 'body', 'logout'])
  expect(Object.keys(en.removedStaff)).toEqual(Object.keys(ja.removedStaff))
  expect(ja.removedStaff.logout).toBe(ja.unassignedStore.logout)
  expect(en.removedStaff.logout).toBe(en.unassignedStore.logout)
})
