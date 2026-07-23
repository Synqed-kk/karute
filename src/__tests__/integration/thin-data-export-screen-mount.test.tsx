/**
 * @jest-environment jsdom
 *
 * Data-export screen wired mount (design-parity packet 23, the S5 lesson —
 * same pattern as thin-welcome-screen-mount.test.tsx): mounts the REAL
 * DataExportScreen → REAL DataExportView through the REAL DataPort seam
 * (mocked apiFetch only), with REAL messages/ja.json (throw-on-missing-key
 * t()) so a typo'd i18n key fails loud instead of silently rendering the raw
 * key. Pins: the DTO's totals/recipientEmail render through to a real
 * dataExport string (the eyebrow label) · the scope picker renders the
 * customers total from the DTO.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'

// PageHeader calls useRouter() from '@/i18n/navigation' at render time (the
// switchToImport/exportSettings buttons) — mapped to the REAL thin nav port,
// same seam the vite build maps it to (thin-chrome.test.tsx /
// thin-welcome-screen-mount.test.tsx precedent). The bare module also drags
// in next-intl's ESM navigation build, which jest can't parse at all.
jest.mock('@/i18n/navigation', () => jest.requireActual('../../../thin/ports/nav.vite'))

// Assertable toast spies (round 4): an ABORTED export must stay silent —
// no exportFailed toast for a request the user already replaced.
const toastError = jest.fn()
jest.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    message: jest.fn(),
    success: jest.fn(),
  },
}))

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

import { DataExportScreen } from '../../../thin/screens/DataExportScreen'

const dto = {
  totals: { customers: 128, bookings: 45, karute: 60 },
  recipientEmail: 'owner@la-estro.jp',
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

describe('DataExportScreen — wired mount (design-parity packet 23)', () => {
  it('renders the REAL DataExportView with a rendered dataExport string, and the DTO totals', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/data-export') return jsonResponse(dto)
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<DataExportScreen />)

    // dataExport.title, a REAL ja.json string rendered through the REAL
    // component tree (not the raw i18n key) — proves the mount is wired.
    expect(await screen.findByText('データエクスポート')).toBeTruthy()

    // The scope picker renders the customers total from the DTO.
    expect(await screen.findByText('128件のレコード')).toBeTruthy()
  })

  it('the export CTA fetches through the port exportBase seam — never a hardcoded /api/export (Greptile P1, #588)', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/data-export') return jsonResponse(dto)
      if (path.startsWith('/pin/export-base?'))
        return { ok: true, blob: async () => new Blob(['csv']) } as unknown as Response
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({
      apiFetch,
      exportBase: '/pin/export-base',
      supportsAutoDeliver: false,
      deliverFile: jest.fn(),
    } as unknown as Parameters<typeof setDataPort>[0])

    render(<DataExportScreen />)
    const [cta] = await screen.findAllByText(/をエクスポート$/)
    fireEvent.click(cta)

    // The sentinel base proves the view consulted port.exportBase; the query
    // string proves the same params contract rides it.
    await waitFor(() => {
      const exportCall = apiFetch.mock.calls.find(([p]) => p.startsWith('/pin/export-base?'))
      expect(exportCall).toBeTruthy()
      expect(exportCall![0]).toContain('scope=customers')
    })
  })

  it('a scope flip while the export fetch is in flight DROPS the stale result — never the old blob under a new name (fresh-eyes round 2)', async () => {
    let resolveExport!: (r: Response) => void
    const exportPromise = new Promise<Response>((r) => {
      resolveExport = r
    })
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/data-export') return jsonResponse(dto)
      if (path.startsWith('/pin/export-base?')) return exportPromise
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({
      apiFetch,
      exportBase: '/pin/export-base',
      supportsAutoDeliver: false,
      deliverFile: jest.fn(),
    } as unknown as Parameters<typeof setDataPort>[0])

    render(<DataExportScreen />)
    const [cta] = await screen.findAllByText(/をエクスポート$/)
    fireEvent.click(cta)

    // Flip the scope while the fetch is pending…
    fireEvent.click(await screen.findByText('Bookings'))
    // …then the OLD scope's export resolves — and the continuation is FLUSHED
    // before asserting (a bare waitFor here passes vacuously on the
    // pre-continuation state and never catches a missing guard).
    await act(async () => {
      resolveExport({ ok: true, blob: async () => new Blob(['stale']) } as unknown as Response)
      await exportPromise
      await new Promise((r) => setTimeout(r, 0))
    })

    // Back on configure (export CTA rendered), and NO done-step download
    // button anywhere — the stale blob never reached the delivery path.
    expect(screen.getAllByText(/をエクスポート$/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/をダウンロード$/)).toBeNull()
  })

  it('a PRIVACY flip while the export fetch is in flight ABORTS it — raw result dropped, button promptly usable again, NO error toast (fresh-eyes rounds 3+4)', async () => {
    const apiFetch = jest.fn((path: string, init?: RequestInit) => {
      if (path === '/api/app/v1/screens/data-export') return Promise.resolve(jsonResponse(dto))
      if (path.startsWith('/pin/export-base?'))
        // Signal-aware: rejects with AbortError when the view aborts it —
        // never resolves on its own (that's the round-4 dead-window setup).
        return new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () =>
            rej(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          )
        })
      return Promise.reject(new Error(`unexpected apiFetch(${path})`))
    })
    setDataPort({
      apiFetch,
      exportBase: '/pin/export-base',
      supportsAutoDeliver: false,
      deliverFile: jest.fn(),
    } as unknown as Parameters<typeof setDataPort>[0])

    toastError.mockClear()
    render(<DataExportScreen />)
    const [cta] = await screen.findAllByText(/をエクスポート$/)
    fireEvent.click(cta)

    // Flip 個人情報をリダクト while the raw (privacy=0) fetch is pending —
    // the requestKey effect must ABORT the abandoned fetch.
    const privacyLabel = await screen.findByText('個人情報をリダクト')
    fireEvent.click(privacyLabel.closest('div.flex.items-start')!.querySelector('button')!)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    // Raw result never delivered…
    expect(screen.queryByText(/をダウンロード$/)).toBeNull()
    // …the single-flight lock released immediately (no greyed dead window
    // while the abandoned request waits out the network — round 4)…
    const ctaButton = screen.getAllByText(/をエクスポート$/)[0].closest('button') as HTMLButtonElement
    expect(ctaButton.disabled).toBe(false)
    // …and the abandoned request never toasts an error.
    expect(toastError).not.toHaveBeenCalled()
  })

  it('a PRIVACY flip AFTER completion resets the done panel — a held blob never outlives the settings that made it (fresh-eyes round 3)', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/data-export') return jsonResponse(dto)
      if (path.startsWith('/pin/export-base?'))
        return { ok: true, blob: async () => new Blob(['csv']) } as unknown as Response
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({
      apiFetch,
      exportBase: '/pin/export-base',
      supportsAutoDeliver: false,
      deliverFile: jest.fn(),
    } as unknown as Parameters<typeof setDataPort>[0])

    render(<DataExportScreen />)
    const [cta] = await screen.findAllByText(/をエクスポート$/)
    fireEvent.click(cta)
    // Done panel up: the delivery button is present.
    expect((await screen.findAllByText(/をダウンロード$/)).length).toBeGreaterThan(0)

    // Flip 個人情報をリダクト — the held blob no longer matches the screen.
    const privacyLabel = await screen.findByText('個人情報をリダクト')
    fireEvent.click(privacyLabel.closest('div.flex.items-start')!.querySelector('button')!)

    await waitFor(() => {
      expect(screen.queryByText(/をダウンロード$/)).toBeNull()
    })
  })

  it('a failed fetch renders the retry error state, not a crash', async () => {
    const apiFetch = jest.fn(async () => {
      throw new Error('network down')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<DataExportScreen />)

    expect(await screen.findByText('network down')).toBeTruthy()
  })
})
