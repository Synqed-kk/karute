/** @jest-environment jsdom */
// Thin router change smoke (design-parity packet 23): /data-export now
// renders the real DataExportScreen instead of the 準備中 PendingScreen
// placeholder, and PENDING_WEB_ROUTES no longer lists it. Every sibling
// screen is stubbed — this test pins ROUTING, not screen internals (those
// are covered by app-api-screens-data-export.test.ts +
// thin-data-export-screen-mount.test.tsx).

jest.mock('../../../thin/screens/DataExportScreen', () => ({
  DataExportScreen: () => <div data-testid="data-export-screen">DATA_EXPORT</div>,
}))
jest.mock('../../../thin/screens/SettingsScreen', () => ({
  SettingsScreen: () => <div>SETTINGS</div>,
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
jest.mock('../../../thin/screens/WelcomeScreen', () => ({
  WelcomeScreen: () => <div>WELCOME</div>,
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

describe('ThinRouter — /data-export (design-parity packet 23)', () => {
  it('renders the real DataExportScreen, not PendingScreen', () => {
    renderAt('/data-export')
    expect(screen.getByTestId('data-export-screen')).toBeTruthy()
    expect(screen.queryByText('この画面は準備中です')).toBeNull()
  })

  it('PENDING_WEB_ROUTES no longer lists /data-export (source-parity lock)', () => {
    const src = readFileSync(join(process.cwd(), 'thin/router.tsx'), 'utf8')
    const match = /const PENDING_WEB_ROUTES = \[([\s\S]*?)\]/.exec(src)
    expect(match).not.toBeNull()
    expect(match![1]).not.toContain("'/data-export'")
  })

  it('a still-pending route (e.g. /coaching) keeps rendering PendingScreen', () => {
    renderAt('/coaching')
    expect(screen.getByText('この画面は準備中です')).toBeTruthy()
  })
})
