/** @jest-environment jsdom */
// Thin router change smoke (design-parity packet 21): /welcome now renders
// the real WelcomeScreen instead of the 準備中 PendingScreen placeholder, and
// PENDING_WEB_ROUTES no longer lists it. Every sibling screen is stubbed —
// this test pins ROUTING, not screen internals (those are covered by
// app-api-screens-welcome.test.ts + the wired-mount/port-validation suites).

jest.mock('../../../thin/screens/WelcomeScreen', () => ({
  WelcomeScreen: () => <div data-testid="welcome-screen">WELCOME_SCREEN</div>,
}))
jest.mock('../../../thin/screens/ProfileScreen', () => ({
  ProfileScreen: () => <div>PROFILE</div>,
}))
// SettingsScreen pulls the REAL SettingsShell (packet 12 §S1), which imports
// next-intl directly — this suite doesn't mock next-intl, so an unstubbed
// import here would break the router's whole module graph for every test in
// this file (same reason ProfileScreen/WelcomeScreen get testid stubs above).
jest.mock('../../../thin/screens/SettingsScreen', () => ({
  SettingsScreen: () => <div>SETTINGS</div>,
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
// DataExportScreen pulls the REAL DataExportView (packet 23), which imports
// next-intl (and '@/i18n/navigation') directly — same reason SettingsScreen
// gets a stub above.
jest.mock('../../../thin/screens/DataExportScreen', () => ({
  DataExportScreen: () => <div>DATA_EXPORT</div>,
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

describe('ThinRouter — /welcome (design-parity packet 21)', () => {
  it('renders the real WelcomeScreen, not PendingScreen', () => {
    renderAt('/welcome')
    expect(screen.getByTestId('welcome-screen')).toBeTruthy()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })

  it('PENDING_WEB_ROUTES no longer lists /welcome (source-parity lock)', () => {
    const src = readFileSync(join(process.cwd(), 'thin/router.tsx'), 'utf8')
    const match = /const PENDING_WEB_ROUTES = \[([\s\S]*?)\]/.exec(src)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain("'/welcome'")
  })

  it('a still-pending route (e.g. /coaching) keeps rendering PendingScreen', () => {
    renderAt('/coaching')
    expect(screen.getByText('この画面は準備中です')).toBeTruthy()
  })
})
