/** @jest-environment jsdom */
// Thin router change smoke (design-parity packet 12 §S1): /settings now
// renders the real SettingsScreen instead of the 準備中 PendingScreen
// placeholder, and PENDING_WEB_ROUTES no longer lists it. Every sibling
// screen is stubbed — this test pins ROUTING, not screen internals (those
// are covered by app-api-screens-settings.test.ts + SettingsShell's own
// pendingTabIds coverage).

jest.mock('../../../thin/screens/SettingsScreen', () => ({
  SettingsScreen: () => <div data-testid="settings-screen">SETTINGS_SCREEN</div>,
}))
jest.mock('../../../thin/screens/ProfileScreen', () => ({
  ProfileScreen: () => <div>PROFILE</div>,
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

describe('ThinRouter — /settings (design-parity packet 12 §S1)', () => {
  it('renders the real SettingsScreen, not PendingScreen', () => {
    renderAt('/settings')
    expect(screen.getByTestId('settings-screen')).toBeTruthy()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })

  it('PENDING_WEB_ROUTES no longer lists /settings (source-parity lock)', () => {
    const src = readFileSync(join(process.cwd(), 'thin/router.tsx'), 'utf8')
    const match = /const PENDING_WEB_ROUTES = \[([\s\S]*?)\]/.exec(src)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain("'/settings'")
  })

  it('a still-pending route (e.g. /coaching) keeps rendering PendingScreen', () => {
    renderAt('/coaching')
    expect(screen.getByText('この画面は準備中です')).toBeTruthy()
  })
})
