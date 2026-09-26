/**
 * @jest-environment jsdom
 *
 * Round 2 (2026-09-24, D-S16-4, discussed, default) — THE OUTAGE SCREEN the
 * (app) layout renders when the store / roster / permission read failed: the
 * unassigned screen's layout with its own words, a retry that reloads (the
 * gate is server-side), and an automatic retry every 30 s. Never blank.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
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

import { OUTAGE_RETRY_MS, StoreOutageScreen } from '@/components/layout/StoreOutageScreen'

const originalLocation = window.location
const reload = jest.fn()

beforeEach(() => {
  jest.useFakeTimers()
  reload.mockClear()
  // jsdom exposes location as configurable; production uses the real reload.
  Object.defineProperty(window, 'location', { configurable: true, value: { reload } })
})
afterEach(() => {
  jest.useRealTimers()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

it('says what happened and what to do — from the catalogue, never blank', () => {
  render(<StoreOutageScreen />)
  expect(screen.getByRole('heading', { name: ja.storeOutage.title })).toBeInTheDocument()
  expect(screen.getByText(ja.storeOutage.body)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: ja.storeOutage.retry })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: ja.storeOutage.logout })).toBeInTheDocument()
})

it('the retry button reloads (the gate is server-side)', () => {
  render(<StoreOutageScreen />)
  fireEvent.click(screen.getByRole('button', { name: ja.storeOutage.retry }))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('retries on its own every 30 s, and stops when unmounted', () => {
  const { unmount } = render(<StoreOutageScreen />)
  expect(reload).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(OUTAGE_RETRY_MS))
  expect(reload).toHaveBeenCalledTimes(1)
  unmount()
  act(() => jest.advanceTimersByTime(OUTAGE_RETRY_MS * 2))
  expect(reload).toHaveBeenCalledTimes(1)
})

it('catalogue: ja/en carry the same keys; retry is the error boundary’s own word; logout matches the unassigned screen', () => {
  expect(Object.keys(en.storeOutage)).toEqual(Object.keys(ja.storeOutage))
  expect(ja.storeOutage.retry).toBe('もう一度読み込む')
  expect(ja.storeOutage.logout).toBe(ja.unassignedStore.logout)
  expect(en.storeOutage.logout).toBe(en.unassignedStore.logout)
})
