/**
 * @jest-environment jsdom
 *
 * ⚖ R57 V2 — ログアウト in the icon strip: aria-label and title are the ja.json S1 key, the glyph is
 * the only content, a failed sign-out re-enables the button and prints S4 (role=status).
 */
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BusinessSignOutButton, loginHrefAfterSignOut, signOutNav } from '@/app/[locale]/(business)/BusinessSignOutButton'
import { businessStrings } from '@/business/i18n'

const S = businessStrings.shell
afterEach(cleanup)

describe('R57 V2 — the strip sign-out', () => {
  it('icon form: aria-label = title = S1, glyph only, never the text', () => {
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} icon={<svg data-testid="g" />} />)
    const btn = screen.getByRole('button', { name: S.signOut })
    expect(btn.getAttribute('aria-label')).toBe('ログアウト')
    expect(btn.getAttribute('title')).toBe('ログアウト')
    expect(btn.className).toBe('sign-out-icon')
    expect(btn.textContent).toBe('')
  })

  it('a refused sign-out re-enables the button and prints S4 as a status line', async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }))
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} icon={<svg />} />)
    const assign = jest.spyOn(signOutNav, 'assign').mockImplementation(() => {})
    const btn = screen.getByRole('button', { name: S.signOut })
    await act(async () => { fireEvent.click(btn) })
    expect(fetchMock).toHaveBeenCalledWith('/api/business/sign-out', { method: 'POST', credentials: 'same-origin' })
    expect(assign).not.toHaveBeenCalled()
    assign.mockRestore()
    expect(screen.getByRole('status').textContent).toBe('ログアウトできませんでした。もう一度お試しください。')
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('the sidebar mounts BOTH forms from the S1 key, and the strip avatar carries name · e-mail', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/BusinessSidebar.tsx'), 'utf8')
    expect(src.match(/<BusinessSignOutButton locale=\{locale\} label=\{shellStrings\.signOut\}/g)).toHaveLength(2)
    expect(src).toContain('icon={GLYPH.signOut}')
    expect(src).toContain('`${viewerName} · ${viewerEmail}`')
  })
})

// ⚖ S41 (Liam 9/30 17:4x) — the login URL after sign-out carries next=<the Business page>, in the
// proxy's shape (pathname + search, src/proxy.ts:63-73), so signing in again returns to Business.
describe('S41 — sign-out returns to Business via next=', () => {
  it('helper: settings → /ja/login?next=%2Fja%2Fbusiness%2Fsettings', () => {
    expect(loginHrefAfterSignOut('ja', '/ja/business/settings', '')).toBe('/ja/login?next=%2Fja%2Fbusiness%2Fsettings')
  })
  it('helper: a second Business room, another locale', () => {
    expect(loginHrefAfterSignOut('en', '/en/business/reservations', '')).toBe('/en/login?next=%2Fen%2Fbusiness%2Freservations')
  })
  it('helper: unicode and spaces in the pathname are encoded', () => {
    expect(loginHrefAfterSignOut('ja', '/ja/business/お客様 一覧', '')).toBe('/ja/login?next=%2Fja%2Fbusiness%2F%E3%81%8A%E5%AE%A2%E6%A7%98%20%E4%B8%80%E8%A6%A7')
  })
  it('helper: the search string rides along, encoded (proxy shape pathname + search)', () => {
    expect(loginHrefAfterSignOut('ja', '/ja/business/reservations', '?store=aa36&view=week')).toBe('/ja/login?next=%2Fja%2Fbusiness%2Freservations%3Fstore%3Daa36%26view%3Dweek')
  })
  it('a 200 sign-out on /ja/business/reservations navigates to /ja/login?next=%2Fja%2Fbusiness%2Freservations', async () => {
    window.history.pushState({}, '', '/ja/business/reservations')
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    const assign = jest.spyOn(signOutNav, 'assign').mockImplementation(() => {})
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: S.signOut })) })
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('/ja/login?next=%2Fja%2Fbusiness%2Freservations')
    expect(screen.queryByRole('status')).toBeNull()
    assign.mockRestore()
  })
})
