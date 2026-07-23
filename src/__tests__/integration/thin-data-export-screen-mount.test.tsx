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
import { render, screen } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'

// PageHeader calls useRouter() from '@/i18n/navigation' at render time (the
// switchToImport/exportSettings buttons) — mapped to the REAL thin nav port,
// same seam the vite build maps it to (thin-chrome.test.tsx /
// thin-welcome-screen-mount.test.tsx precedent). The bare module also drags
// in next-intl's ESM navigation build, which jest can't parse at all.
jest.mock('@/i18n/navigation', () => jest.requireActual('../../../thin/ports/nav.vite'))

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

  it('a failed fetch renders the retry error state, not a crash', async () => {
    const apiFetch = jest.fn(async () => {
      throw new Error('network down')
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<DataExportScreen />)

    expect(await screen.findByText('network down')).toBeTruthy()
  })
})
