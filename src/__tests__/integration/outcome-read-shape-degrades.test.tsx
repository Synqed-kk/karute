/**
 * @jest-environment jsdom
 *
 * The READ side of the outcome value must degrade, never hard-fail (F3).
 *
 * A shell is BAKED with whatever schema it shipped with. When the server starts
 * writing a value that shell has never heard of — exactly what adding 'revisit'
 * just did to every 4.5/code-11 shell in the field — a strict read enum would
 * fail the WHOLE detail-screen parse, blanking the screen over one chip. So the
 * read shape is z.string() and the card renders a neutral fallback chip for an
 * unknown value. The WRITE schemas stay strict 4-value (pinned below).
 */
import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur
      },
  }
})
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('@/actions/karute-outcome', () => ({ updateKaruteOutcome: jest.fn() }))

import { OutcomeCard } from '@/components/karute/redesign/detail/OutcomeCard'
import { KaruteDetailScreenDTO } from '@/lib/app-api/karute-detail-screen-dto'
import { SaveKaruteSchema } from '@/lib/app-api/record-schemas'

const FUTURE = 'someday_future_value'

function detailPayload(outcome: string) {
  return {
    karuteId: 'k-1',
    customerId: 'c-1',
    outcome: {
      outcome,
      reason: null,
      is_first_visit: false,
      decided_at: null,
      auto_decided: false,
    },
    header: {
      customerName: '廣瀬浩子',
      initials: 'HK',
      karuteNumber: '#00007',
      service: 'カット',
      sessionDateLong: '2026年8月10日',
      staffName: '田中',
      phone: null,
      email: null,
      age: null,
      gender: null,
      visitNumber: 3,
      lastVisitDate: null,
    },
    sessionDateLong: '2026年8月10日',
    sessionDateIso: null,
    entries: [],
    summaryBullets: [],
    transcript: null,
    transcriptRestricted: false,
    transcriptDurationLabel: '5分',
    photos: [],
    memory: null,
    consentOnFile: false,
    viewerRole: 'practitioner',
  }
}

function mountCard(outcome: string) {
  render(
    <OutcomeCard
      karuteRecordId="k-1"
      customerId="c-1"
      customerName="廣瀬浩子"
      current={{ outcome, reason: null, autoDecided: false, isFirstVisit: false }}
    />,
  )
}

describe('detail-screen DTO — unknown outcome degrades instead of failing', () => {
  it('parses a payload carrying a value this build has never heard of', () => {
    const parsed = KaruteDetailScreenDTO.parse(detailPayload(FUTURE))
    expect(parsed.outcome?.outcome).toBe(FUTURE)
  })

  it('still parses the four known values', () => {
    for (const v of ['success', 'no_deal', 'pending', 'revisit']) {
      expect(KaruteDetailScreenDTO.parse(detailPayload(v)).outcome?.outcome).toBe(v)
    }
  })
})

describe('OutcomeCard — unknown outcome renders the fallback chip, never throws', () => {
  it('renders the raw value in a neutral chip', () => {
    mountCard(FUTURE)
    const chip = screen.getByText(FUTURE)
    expect(chip).toBeInTheDocument()
    expect(chip.className).toContain('bg-muted')
    // Not the 未記録 empty state — a row EXISTS, we just can't label it.
    expect(screen.queryByText('結果 未記録')).toBeNull()
  })

  it('renders the real label + tone for a known value', () => {
    mountCard('revisit')
    const chip = screen.getByText('通常ご来店')
    expect(chip.className).toContain('bg-slate-50')
  })
})

describe('write schemas stay STRICT — only the read shape degrades', () => {
  it('rejects an unknown outcome on save', () => {
    const save = (status: string) =>
      SaveKaruteSchema.safeParse({
        customerId: 'c-1',
        transcript: 't',
        summary: 's',
        entries: [],
        outcome: { status, isFirstVisit: false },
      })
    expect(save(FUTURE).success).toBe(false)
    expect(save('revisit').success).toBe(true)
  })
})

// F2 — one-way door. A row already saved as 'revisit' must stay re-selectable
// in 編集; every other status keeps the card hidden (UNKNOWN), because no other
// outcome value proves the customer is a returning one.
describe('OutcomeCard 編集 — the revisit option survives the edit path', () => {
  const openEditor = (outcome: string) => {
    mountCard(outcome)
    fireEvent.click(screen.getByText('結果を変更'))
  }

  it('a saved revisit row re-offers the 既存のお客様 card', () => {
    openEditor('revisit')
    expect(screen.getByText('既存のお客様（通常ご来店）')).toBeInTheDocument()
  })

  it('any other status leaves it hidden (no returning-customer proof)', () => {
    openEditor('success')
    expect(screen.queryByText('既存のお客様（通常ご来店）')).toBeNull()
  })
})
