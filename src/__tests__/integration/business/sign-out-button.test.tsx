/**
 * @jest-environment jsdom
 *
 * ⚖ R53 / R57 V2 / S41 — ログアウト, by BEHAVIOUR: the icon and text forms, the next= target, the ordering
 * against the POST, the in-flight guard, S4 on failure, and the card as the sidebar renders it.
 */
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import { BusinessSignOutButton, loginHrefAfterSignOut, signOutNav } from '@/app/[locale]/(business)/BusinessSignOutButton'
import { BusinessSidebar } from '@/app/[locale]/(business)/BusinessSidebar'
import { businessStrings } from '@/business/i18n'

jest.mock('next/navigation', () => ({
  usePathname: () => '/ja/business/settings',
  useSearchParams: () => new URLSearchParams(),
}))

const S = businessStrings.shell
// jsdom has no global Response: plain response-shaped objects, so the status path is exercised, never the catch.
const reply = (status: number) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ ok: status < 300 }) })
let nav: jest.SpyInstance
beforeEach(() => { nav = jest.spyOn(signOutNav, 'replace').mockImplementation(() => {}) })
afterEach(() => { cleanup(); nav.mockRestore() })
const setFetch = (fn: jest.Mock) => { (globalThis as { fetch: unknown }).fetch = fn }

describe('R57 V2 — the strip sign-out', () => {
  it('icon form: aria-label = title = S1, glyph only, never the text', () => {
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} icon={<svg data-testid="g" />} />)
    const btn = screen.getByRole('button', { name: S.signOut })
    expect(btn.getAttribute('aria-label')).toBe('ログアウト')
    expect(btn.getAttribute('title')).toBe('ログアウト')
    expect(btn.className).toBe('sign-out-icon')
    expect(btn.textContent).toBe('')
  })

  it('a refused (500) sign-out never navigates, re-enables the button and prints S4 as a status line', async () => {
    const fetchMock = jest.fn(async () => reply(500)); setFetch(fetchMock)
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} icon={<svg />} />)
    const btn = screen.getByRole('button', { name: S.signOut })
    await act(async () => { fireEvent.click(btn) })
    expect(fetchMock).toHaveBeenCalledWith('/api/business/sign-out', { method: 'POST', credentials: 'same-origin' })
    expect(nav).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('ログアウトできませんでした。もう一度お試しください。')
    expect((btn as HTMLButtonElement).disabled).toBe(false)
  })

  it('a rejected fetch (network) never navigates and prints S4', async () => {
    setFetch(jest.fn(async () => { throw new Error('offline') }))
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: S.signOut })) })
    expect(nav).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toBeTruthy()
  })
})

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
  it('ORDER: with the POST deferred, no navigation until it resolves; then exactly one replace with the next= href', async () => {
    window.history.pushState({}, '', '/ja/business/reservations')
    let resolve!: (v: unknown) => void
    setFetch(jest.fn(() => new Promise((r) => { resolve = r })))
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: S.signOut })) })
    expect(nav).not.toHaveBeenCalled()
    await act(async () => { resolve(reply(200)) })
    expect(nav).toHaveBeenCalledTimes(1)
    expect(nav).toHaveBeenCalledWith('/ja/login?next=%2Fja%2Fbusiness%2Freservations')
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('IN-FLIGHT GUARD: two clicks in one task send ONE POST', async () => {
    const fetchMock = jest.fn(() => new Promise(() => {})); setFetch(fetchMock)
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} />)
    const btn = screen.getByRole('button', { name: S.signOut })
    await act(async () => { btn.click(); btn.click() })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('the identity card as the sidebar renders it', () => {
  const base = { locale: 'ja', businessName: 'Dev Salon', storeCount: 1, viewerRoleLabel: 'オーナー', stores: [{ id: 's1', name: 'テスト東京店' }], unresolved: { byStore: {}, all: 0 } }
  it('both controls render; the icon one carries aria-label = title = S1; the avatar title is 「name · email」', () => {
    const { container } = render(<BusinessSidebar {...base} viewerName="Dev Salon" viewerMark="Dev" viewerEmail="dev@karute.test" />)
    const icon = container.querySelector('.operator .sign-out-icon')!
    expect(icon.getAttribute('aria-label')).toBe(S.signOut)
    expect(icon.getAttribute('title')).toBe(S.signOut)
    expect(container.querySelector('.operator .sign-out')!.textContent).toBe(S.signOut)
    expect(container.querySelector('.operator .avatar')!.getAttribute('title')).toBe('Dev Salon · dev@karute.test')
    expect(container.querySelector('.operator .operator-email')!.textContent).toBe('dev@karute.test')
  })
  it('name === e-mail → no e-mail line, avatar title is the name alone', () => {
    const { container } = render(<BusinessSidebar {...base} viewerName="dev@karute.test" viewerMark="D" viewerEmail="dev@karute.test" viewerRoleLabel={null} />)
    expect(container.querySelector('.operator .operator-email')).toBeNull()
    expect(container.querySelector('.operator .avatar')!.getAttribute('title')).toBe('dev@karute.test')
  })
  it('a 60-char name renders whole (wraps via CSS, never truncated in markup)', () => {
    const long = 'あ'.repeat(30) + 'LongNameWithoutSpaces'.padEnd(30, 'x')
    const { container } = render(<BusinessSidebar {...base} viewerName={long} viewerMark="あ" viewerEmail="dev@karute.test" />)
    expect(container.querySelector('.operator strong')!.textContent).toBe(long)
  })
})
