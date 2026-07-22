/**
 * @jest-environment jsdom
 *
 * Welcome screen wired mount (design-parity packet 21, spec item 2 — the S5
 * lesson): mounts the REAL WelcomeScreen → REAL WelcomeWizard through the
 * REAL DataPort seam (mocked apiFetch only), with REAL messages/ja.json
 * (throw-on-missing-key t(), same pattern as
 * thin-dashboard-screen-render.test.tsx) so a typo'd i18n key fails loud
 * instead of silently rendering the raw key. Pins: the DTO prefills the
 * store-name input · the app-language fieldset is ABSENT in the shell
 * (WelcomeScreen passes hideLanguageChoice — ruling ②, S5 optional-prop
 * shape) · driving step1→step2→step3 to Finish PATCHes
 * /api/app/v1/org-settings with exactly the 5-field payload (name TRIMMED,
 * setup_completed_at a real ISO string) · on {success:true} the REAL nav
 * port (thin/ports/nav.vite — the module @/i18n/navigation resolves to in
 * the vite bundle, thin-chrome.test.tsx precedent) pushes to /dashboard.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) => (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
    useLocale: () => 'ja',
  }
})

// The nav seam, mapped exactly as the vite build maps it (thin-chrome.test.tsx
// precedent): @/i18n/navigation resolves to the REAL thin nav port, so
// push('/dashboard') has a real, assertable effect (location.pathname).
jest.mock('@/i18n/navigation', () => jest.requireActual('../../../thin/ports/nav.vite'))

// The actions seam, mapped the SAME way (thin-chrome.test.tsx precedent):
// @/actions/org-settings resolves to the REAL thin actions port, so
// WelcomeWizard's completeOnboarding import is the REAL facadeCompleteOnboarding
// — driving the real validation + PATCH call, not a stand-in. The real
// src/actions/org-settings.ts ('use server') pulls next/cache internals that
// TextEncoder-crash under this jest config (same reason DashboardScreenInner's
// suite stubs OwnerBand/TodoCard instead of letting them resolve '@/actions/packs'
// for real) — rerouting the specifier avoids ever loading that file.
jest.mock('@/actions/org-settings', () => jest.requireActual('../../../thin/ports/actions.vite'))

import { WelcomeScreen } from '../../../thin/screens/WelcomeScreen'

const dto = {
  salon_name: 'テストサロン',
  business_type: 'hair_salon',
  recording_disclosure_mode: null as 'A' | 'B' | 'C' | null,
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

describe('WelcomeScreen — wired mount (design-parity packet 21)', () => {
  afterEach(() => {
    history.replaceState({}, '', '/')
  })

  it('prefills from the DTO, hides the language fieldset under native, and Finish PATCHes org-settings + navigates to /dashboard', async () => {
    const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/app/v1/screens/welcome' && !init) return jsonResponse(dto)
      if (path === '/api/app/v1/org-settings' && init?.method === 'PATCH') {
        return jsonResponse({ success: true })
      }
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<WelcomeScreen />)

    // Prefill: the store-name input carries the DTO's salon_name.
    const nameInput = await screen.findByDisplayValue('テストサロン')

    // hideLanguageChoice (passed by WelcomeScreen): the app-language
    // fieldset never renders in the shell.
    expect(screen.queryByText('日本語')).toBeNull()
    expect(screen.queryByText('English')).toBeNull()

    // Step 1 → 2. Exercise the store-name trim end-to-end (leading/trailing
    // whitespace a user could plausibly type or paste).
    fireEvent.change(nameInput, { target: { value: '  La Estro  ' } })
    fireEvent.click(screen.getByText('次へ'))

    // Step 2 → 3. Mode B needs no privacy confirmation.
    fireEvent.click(screen.getByText('Verbal disclosure (recommended)'))
    fireEvent.click(screen.getByText('次へ'))

    // Step 3 → Finish.
    fireEvent.click(screen.getByText('セットアップ完了'))

    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith(
        '/api/app/v1/org-settings',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )

    const patchCall = apiFetch.mock.calls.find(([path]) => path === '/api/app/v1/org-settings')
    const [, init] = patchCall as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      salon_name: 'La Estro',
      business_type: 'hair_salon',
      recording_disclosure_mode: 'B',
      recording_disclosure_privacy_confirmed: false,
    })
    expect(new Date(body.setup_completed_at).toISOString()).toBe(body.setup_completed_at)

    await waitFor(() => expect(location.pathname).toBe('/dashboard'))
  })

  it('a failing Finish renders the error banner and re-enables the button — no navigation', async () => {
    const apiFetch = jest.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/app/v1/screens/welcome' && !init) return jsonResponse(dto)
      if (path === '/api/app/v1/org-settings' && init?.method === 'PATCH') {
        // The core's business-level { error } rides the 2xx body verbatim
        // (RPC passthrough) — the wizard must surface it, not swallow it.
        return jsonResponse({ error: '保存に失敗しました' })
      }
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<WelcomeScreen />)
    await screen.findByDisplayValue('テストサロン')

    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('Verbal disclosure (recommended)'))
    fireEvent.click(screen.getByText('次へ'))
    fireEvent.click(screen.getByText('セットアップ完了'))

    // Banner shows the returned error verbatim (WelcomeWizard's setError
    // branch), the button leaves its submitting state, and we stay put.
    expect(await screen.findByText('保存に失敗しました')).toBeTruthy()
    const finish = screen.getByText('セットアップ完了').closest('button')
    expect(finish?.disabled).toBe(false)
    expect(location.pathname).not.toBe('/dashboard')
  })
})
