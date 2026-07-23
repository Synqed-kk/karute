/** @jest-environment jsdom */
// Thin router change smoke (design-parity Gap B-1 PR 2): /dashboard now
// renders the real DashboardScreen instead of the 準備中 PendingScreen
// placeholder, and PENDING_WEB_ROUTES no longer lists it. Every sibling
// screen is stubbed — this test pins ROUTING, not screen internals (those
// are covered by app-api-screens-dashboard.test.ts + the DashboardPageView
// component's own coverage).

jest.mock('../../../thin/screens/DashboardScreen', () => ({
  DashboardScreen: () => <div data-testid="dashboard-screen">DASHBOARD_SCREEN</div>,
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
  CustomerProfileScreen: () => <div>PROFILE</div>,
}))
jest.mock('../../../thin/screens/KaruteDetailScreen', () => ({
  KaruteDetailScreen: () => <div>KARUTE_DETAIL</div>,
}))
// ProfileScreen pulls the REAL ProfilePageView (packet 12 §B-2), which
// imports next-intl directly — this suite doesn't mock next-intl (it never
// needed to before /profile had a real screen), so an unstubbed import here
// would break the router's whole module graph for every test in this file.
jest.mock('../../../thin/screens/ProfileScreen', () => ({
  ProfileScreen: () => <div>PROFILE</div>,
}))
// Same reason: SettingsScreen pulls the REAL SettingsShell (packet 12 §S1),
// which also imports next-intl directly.
jest.mock('../../../thin/screens/SettingsScreen', () => ({
  SettingsScreen: () => <div>SETTINGS</div>,
}))
// Same reason: WelcomeScreen pulls the REAL WelcomeWizard (packet 21), which
// also imports next-intl (and '@/actions/org-settings') directly.
jest.mock('../../../thin/screens/WelcomeScreen', () => ({
  WelcomeScreen: () => <div>WELCOME</div>,
}))
// Same reason: DataExportScreen pulls the REAL DataExportView (packet 23),
// which also imports next-intl (and '@/i18n/navigation') directly.
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

describe('ThinRouter — /dashboard (design-parity Gap B-1 PR 2)', () => {
  it('renders the real DashboardScreen, not PendingScreen', () => {
    renderAt('/dashboard')
    expect(screen.getByTestId('dashboard-screen')).toBeTruthy()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })

  it('PENDING_WEB_ROUTES no longer lists /dashboard (source-parity lock)', () => {
    const src = readFileSync(join(process.cwd(), 'thin/router.tsx'), 'utf8')
    const match = /const PENDING_WEB_ROUTES = \[([\s\S]*?)\]/.exec(src)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain("'/dashboard'")
  })

  it('a still-pending route (e.g. /coaching) keeps rendering PendingScreen', () => {
    renderAt('/coaching')
    expect(screen.getByText('この画面は準備中です')).toBeTruthy()
  })
})
