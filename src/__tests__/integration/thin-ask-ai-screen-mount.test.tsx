/**
 * @jest-environment jsdom
 *
 * Ask-AI screen wired mount (ja sweep, packet 27 follow-up): mounts the REAL
 * AskAiScreen → REAL AIAssistantView through the REAL DataPort seam (mocked
 * apiFetch only), with REAL messages/ja.json (throw-on-missing-key t(), same
 * pattern as thin-data-export-screen-mount.test.tsx) so a typo'd i18n key
 * fails loud. Kills a revert of either ja-sweep call-site fix in
 * thin/screens/AskAiScreen.tsx: (a) getBusinessProfile/getConsultationQuestions
 * missing the 'ja' arg (prompt cards would fall back to English), (b) the
 * scope chips reverting to hardcoded English labels.
 */
import { render, screen } from '@testing-library/react'
import { setDataPort } from '@/lib/ports/data-port'
import { dtoCache } from '../../../thin/screens/ScreenBoundary'

// jsdom doesn't implement scrollIntoView — AIAssistantView calls it in a
// mount effect (auto-scroll-to-latest-message), unrelated to this pin.
Element.prototype.scrollIntoView = jest.fn()

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

// Same seam mapping as thin-data-export/thin-welcome mount tests: the bare
// '@/i18n/navigation' module drags in next-intl's ESM navigation build,
// which jest can't parse — map it to the REAL thin nav port instead.
jest.mock('@/i18n/navigation', () => jest.requireActual('../../../thin/ports/nav.vite'))

import { AskAiScreen } from '../../../thin/screens/AskAiScreen'

const dto = {
  scope: { karute: 12, customers: 34, bookings: 5, recordings: 3 },
  businessType: 'beauty_chiropractic',
  userName: 'テスト太郎',
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

describe('AskAiScreen — wired mount (ja sweep)', () => {
  beforeEach(() => dtoCache.clear())

  it('prompt cards render titleJa, and scope chips render the Ja i18n keys — not English', async () => {
    const apiFetch = jest.fn(async (path: string) => {
      if (path === '/api/app/v1/screens/ask-ai') return jsonResponse(dto)
      throw new Error(`unexpected apiFetch(${path})`)
    })
    setDataPort({ apiFetch } as unknown as Parameters<typeof setDataPort>[0])

    render(<AskAiScreen />)

    // (a) getConsultationQuestions(businessType, 'ja') — beauty_chiropractic's
    // first prompt card shows its titleJa, never the English title.
    expect(await screen.findByText('ブライダル目標のお客様')).toBeTruthy()
    expect(screen.queryByText('Bridal-goal customers')).toBeNull()

    // (b) scope chips use the real askAi.scope* ja.json strings, not the
    // hardcoded English labels the addendum commit replaced. getAllByText
    // (not getByText) for 顧客 — it also legitimately matches the "Customer"
    // prompt-category chip (PromptTemplateCard's own ja label), unrelated to
    // this fix.
    expect(screen.getByText('カルテ')).toBeTruthy()
    expect(screen.getAllByText('顧客').length).toBeGreaterThan(0)
    expect(screen.getByText('予約')).toBeTruthy()
    expect(screen.getByText('録音')).toBeTruthy()
    expect(screen.queryByText('Karute')).toBeNull()
    expect(screen.queryByText('Customers')).toBeNull()
    expect(screen.queryByText('Bookings')).toBeNull()
    expect(screen.queryByText('Recordings')).toBeNull()
  })
})
