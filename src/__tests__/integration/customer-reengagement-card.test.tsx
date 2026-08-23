/**
 * @jest-environment jsdom
 *
 * CustomerReengagementCard — Test #8 (dialog integration: initialBody +
 * source="reengagement") + card-structure pins (tier/days-ago chips, the
 * why-disclosure, and F7's "amber 対応予定 pill is GONE on the real card").
 */
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        if (typeof cur !== 'string') {
          throw new Error(`missing ja.json key: ${ns}.${key}`)
        }
        return cur.replace(/\{(\w+)\}/g, (_, v: string) =>
          String((vars as Record<string, unknown> | undefined)?.[v] ?? `{${v}}`),
        )
      },
  }
})

const messageComposeProps: { current: Record<string, unknown> | null } = { current: null }
jest.mock('@/components/messaging/MessageComposeDialog', () => ({
  MessageComposeDialog: (props: Record<string, unknown>) => {
    messageComposeProps.current = props
    return null
  },
}))

import { CustomerReengagementCard } from '@/components/customers/redesign/profile/CustomerReengagementCard'
import type { ReengagementDraft } from '@/lib/karute/ai-reengagement'

const DRAFT: ReengagementDraft = {
  draft: 'DRAFT-BODY-MARKER',
  reasoning: 'REASONING-MARKER',
  signals: [{ kind: 'memory_item', label: 'SIGNAL-MARKER' }],
  tier: 'dormant',
}

beforeEach(() => {
  messageComposeProps.current = null
})

describe('CustomerReengagementCard — dialog integration (Test #8)', () => {
  it('mounts MessageComposeDialog closed with initialBody=draft.draft and source="reengagement"', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={95} draft={DRAFT} />,
    )
    expect(messageComposeProps.current).toMatchObject({
      open: false,
      source: 'reengagement',
      initialBody: 'DRAFT-BODY-MARKER',
      aiDrafted: true,
    })
    expect(messageComposeProps.current?.customer).toEqual({
      id: 'cust-1',
      name: '田中 花子',
      initials: expect.any(String),
    })
  })

  it('the send button opens the dialog (open flips true, same initialBody/source)', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={95} draft={DRAFT} />,
    )
    fireEvent.click(screen.getByText('このメッセージを送信'))
    expect(messageComposeProps.current).toMatchObject({
      open: true,
      source: 'reengagement',
      initialBody: 'DRAFT-BODY-MARKER',
    })
  })
})

describe('CustomerReengagementCard — structure pins', () => {
  it('renders the draft body, the days-ago chip, and the tier chip', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={95} draft={DRAFT} />,
    )
    expect(screen.getByText('DRAFT-BODY-MARKER')).toBeInTheDocument()
    expect(screen.getByText('95日前')).toBeInTheDocument()
    expect(screen.getByText('休眠リスク')).toBeInTheDocument()
  })

  it('overdue tier renders the 来店遅れ chip', () => {
    render(
      <CustomerReengagementCard
        customerId="cust-1"
        customerName="田中 花子"
        lastVisitAgoDays={65}
        draft={{ ...DRAFT, tier: 'overdue' }}
      />,
    )
    expect(screen.getByText('来店遅れ')).toBeInTheDocument()
  })

  it('F7: the amber 対応予定 pill is GONE on the real card', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={95} draft={DRAFT} />,
    )
    expect(screen.queryByText('対応予定')).not.toBeInTheDocument()
  })

  it('why-disclosure is collapsed by default and reveals reasoning + signals on toggle', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={95} draft={DRAFT} />,
    )
    expect(screen.queryByText('REASONING-MARKER')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('このメッセージの根拠を見る'))
    expect(screen.getByText('REASONING-MARKER')).toBeInTheDocument()
    expect(screen.getByText('SIGNAL-MARKER')).toBeInTheDocument()
  })

  it('null lastVisitAgoDays hides the days-ago chip', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={null} draft={DRAFT} />,
    )
    expect(screen.queryByText(/日前$/)).not.toBeInTheDocument()
  })
})

// G2 (Greptile, batched with the CI audit-doc + G1 cache-key fixes) — one-way
// accent law (accent-tier-contract.test.tsx pattern): the commit button keeps
// the solid theme-token accent, and the decorative session signal icon
// (non-pressable, inside the why-disclosure evidence list) goes neutral.
// Whole-class matcher — same convention as accent-tier-contract.test.tsx.
const cls = (name: string) => new RegExp(`(^|\\s)${name.replace('/', '\\/')}(\\s|$)`)

describe('CustomerReengagementCard — accent tier (G2)', () => {
  it('the send button carries the solid theme-token accent, never a hardcoded blue literal', () => {
    render(
      <CustomerReengagementCard customerId="cust-1" customerName="田中 花子" lastVisitAgoDays={95} draft={DRAFT} />,
    )
    const send = screen.getByText('このメッセージを送信').closest('button')!
    expect(send.className).toMatch(cls('bg-primary'))
    expect(send.className).toMatch(cls('text-primary-foreground'))
    expect(send.className).toMatch(cls('hover:bg-primary-hover'))
    expect(send.className).not.toMatch(cls('bg-blue-600'))
    expect(send.className).not.toMatch(cls('text-white'))
  })

  it('the session signal icon (decorative, inside why-disclosure) is neutral, never accent blue', () => {
    render(
      <CustomerReengagementCard
        customerId="cust-1"
        customerName="田中 花子"
        lastVisitAgoDays={95}
        draft={{ ...DRAFT, signals: [{ kind: 'session', label: 'SESSION-SIGNAL-MARKER' }] }}
      />,
    )
    fireEvent.click(screen.getByText('このメッセージの根拠を見る'))
    const label = screen.getByText('SESSION-SIGNAL-MARKER')
    const icon = label.previousElementSibling
    expect(icon).not.toBeNull()
    expect(icon!.getAttribute('class') ?? '').toMatch(cls('text-muted-foreground'))
    expect(icon!.getAttribute('class') ?? '').not.toMatch(cls('text-blue-600'))
  })
})
