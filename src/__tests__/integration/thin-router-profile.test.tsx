/** @jest-environment jsdom */
// Thin router change smoke (design-parity packet 12 §B-2): /profile now
// renders the real ProfileScreen instead of the 準備中 PendingScreen
// placeholder, and PENDING_WEB_ROUTES no longer lists it. Every sibling
// screen is stubbed — this test pins ROUTING, not screen internals (those
// are covered by app-api-screens-profile.test.ts + ProfilePageView's own
// coverage).

jest.mock('../../../thin/screens/ProfileScreen', () => ({
  ProfileScreen: () => <div data-testid="profile-screen">PROFILE_SCREEN</div>,
}))
jest.mock('../../../thin/screens/DashboardScreen', () => ({
  DashboardScreen: () => <div>DASHBOARD</div>,
}))
jest.mock('../../../thin/screens/AppointmentsScreen', () => ({
  AppointmentsScreen: () => <div>APPOINTMENTS</div>,
}))
jest.mock('../../../thin/screens/AskAiScreen', () => ({ AskAiScreen: () => <div>ASK_AI</div> }))
jest.mock('../../../thin/screens/CustomersScreen', () => ({
  CustomersScreen: () => <div>CUSTOMERS</div>,
}))
jest.mock('../../../thin/screens/SessionsScreen', () => ({
  SessionsScreen: () => <div>SESSIONS</div>,
}))
jest.mock('../../../thin/screens/RecordScreen', () => ({ RecordScreen: () => <div>RECORD</div> }))
jest.mock('../../../thin/screens/CustomerProfileScreen', () => ({
  CustomerProfileScreen: () => <div>CUSTOMER_PROFILE</div>,
}))
jest.mock('../../../thin/screens/KaruteDetailScreen', () => ({
  KaruteDetailScreen: () => <div>KARUTE_DETAIL</div>,
}))

import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ThinRouter } = require('../../../thin/router') as typeof import('../../../thin/router')

function renderAt(pathname: string) {
  window.history.pushState({}, '', pathname)
  return render(<ThinRouter />)
}

describe('ThinRouter — /profile (design-parity packet 12 §B-2)', () => {
  it('renders the real ProfileScreen, not PendingScreen', () => {
    renderAt('/profile')
    expect(screen.getByTestId('profile-screen')).toBeTruthy()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })

  it('PENDING_WEB_ROUTES no longer lists /profile (source-parity lock)', () => {
    const src = readFileSync(join(process.cwd(), 'thin/router.tsx'), 'utf8')
    const match = /const PENDING_WEB_ROUTES = \[([\s\S]*?)\]/.exec(src)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain("'/profile'")
  })

  it('a still-pending route (e.g. /settings) keeps rendering PendingScreen', () => {
    renderAt('/settings')
    expect(screen.getByText('この画面は準備中です')).toBeTruthy()
  })
})
