/**
 * @jest-environment jsdom
 *
 * ⚖ R57 V2 — ログアウト in the icon strip: aria-label and title are the ja.json S1 key, the glyph is
 * the only content, a failed sign-out re-enables the button and prints S4 (role=status).
 */
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BusinessSignOutButton } from '@/app/[locale]/(business)/BusinessSignOutButton'
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
    const fetchMock = jest.fn(async () => new Response('{"ok":false}', { status: 500 }))
    ;(globalThis as { fetch: unknown }).fetch = fetchMock
    render(<BusinessSignOutButton locale="ja" label={S.signOut} failed={S.signOutFailed} icon={<svg />} />)
    const btn = screen.getByRole('button', { name: S.signOut })
    await act(async () => { fireEvent.click(btn) })
    expect(fetchMock).toHaveBeenCalledWith('/api/business/sign-out', { method: 'POST', credentials: 'same-origin' })
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
