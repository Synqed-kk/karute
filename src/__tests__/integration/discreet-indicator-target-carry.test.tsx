/**
 * @jest-environment jsdom
 *
 * DiscreetRecordingIndicator's 開く navigation must carry the live target's
 * customerId exactly like the bottom-nav center button — a bare /sessions
 * push loads the NEXT SCHEDULED booking's page under the live recording
 * (field bug 8/2, blind-round P2). Mock idiom mirrors bottom-nav.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react'

let mockRecState: 'idle' | 'recording' | 'paused' = 'idle'
let mockTarget: { customerId: string; customerName?: string } | null = null
const push = jest.fn()

jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, back: jest.fn() }),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}))
jest.mock('@/hooks/use-global-recorder', () => ({
  useGlobalRecorder: () => ({
    state: mockRecState,
    startedAt: Date.now(),
    stopRecording: jest.fn(),
    target: mockTarget,
  }),
}))
// jsdom can't hold a 450ms pointer — surface the long-press as a click.
jest.mock('@/hooks/use-long-press', () => ({
  useLongPress: ({ onLongPress }: { onLongPress: () => void }) => ({
    onClick: onLongPress,
  }),
}))

import { DiscreetRecordingIndicator } from '@/components/recording/DiscreetRecordingIndicator'

beforeEach(() => {
  jest.clearAllMocks()
  mockRecState = 'idle'
  mockTarget = null
})

function openPopoverAndTapOpen() {
  fireEvent.click(screen.getByLabelText('dotAria'))
  fireEvent.click(screen.getByText('openPage'))
}

describe('DiscreetRecordingIndicator — 開く carries the live target', () => {
  it('pushes /sessions?customerId=<target> when a customer is bound', () => {
    mockRecState = 'recording'
    mockTarget = { customerId: 'cust-A' }
    render(<DiscreetRecordingIndicator />)
    openPopoverAndTapOpen()
    expect(push).toHaveBeenCalledWith('/sessions?customerId=cust-A')
  })

  it('falls back to bare /sessions for an anonymous take', () => {
    mockRecState = 'recording'
    mockTarget = null
    render(<DiscreetRecordingIndicator />)
    openPopoverAndTapOpen()
    expect(push).toHaveBeenCalledWith('/sessions')
  })

  // The outside-close listener is pointerdown, not mousedown: mousedown is a
  // compatibility event, and the bottom bar preventDefaults its touchend
  // (src/lib/tap-activation.ts), which suppresses the whole compat sequence —
  // an outside tap landing on a bar cell would leave this popover up until the
  // 10s auto-close. Reverting the listener to mousedown must fail this test.
  it('an outside pointerdown closes the popover', () => {
    mockRecState = 'recording'
    render(<DiscreetRecordingIndicator />)
    fireEvent.click(screen.getByLabelText('dotAria'))
    expect(screen.getByText('openPage')).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByText('openPage')).not.toBeInTheDocument()
  })
})

// ── Build C part 1a (mock M1-C1): the popover names who this is for ────────
describe('DiscreetRecordingIndicator — the customer nameline', () => {
  it('shows the label + the bound name when a customer is bound', () => {
    mockRecState = 'recording'
    mockTarget = { customerId: 'cust-A', customerName: '佐藤 美咲' }
    render(<DiscreetRecordingIndicator />)
    fireEvent.click(screen.getByLabelText('dotAria'))
    expect(screen.getByText('customerLabel')).toBeInTheDocument()
    // 様 comes from the message file, never hardcoded in the TSX.
    expect(screen.getByText('customerName:{"name":"佐藤 美咲"}')).toBeInTheDocument()
  })

  it('omits the whole card for an anonymous take — never a placeholder', () => {
    mockRecState = 'recording'
    mockTarget = null
    render(<DiscreetRecordingIndicator />)
    fireEvent.click(screen.getByLabelText('dotAria'))
    expect(screen.getByText('openPage')).toBeInTheDocument() // popover IS open
    expect(screen.queryByText('customerLabel')).not.toBeInTheDocument()
    expect(screen.queryByText(/^customerName/)).not.toBeInTheDocument()
  })

  // F4 rider (§2h) — display seam: a bound target whose customerName is
  // whitespace-only must never interpolate blank into the template.
  it('renders the generic fallback for a whitespace-only customerName — never an empty interpolation', () => {
    mockRecState = 'recording'
    mockTarget = { customerId: 'cust-A', customerName: '   ' }
    render(<DiscreetRecordingIndicator />)
    fireEvent.click(screen.getByLabelText('dotAria'))
    expect(screen.getByText('customerLabel')).toBeInTheDocument()
    expect(screen.getByText('customerNameFallback')).toBeInTheDocument()
    expect(screen.queryByText(/^customerName:/)).not.toBeInTheDocument()
  })

  it('renders the generic fallback for a truly empty customerName too', () => {
    mockRecState = 'recording'
    mockTarget = { customerId: 'cust-A', customerName: '' }
    render(<DiscreetRecordingIndicator />)
    fireEvent.click(screen.getByLabelText('dotAria'))
    expect(screen.getByText('customerNameFallback')).toBeInTheDocument()
  })
})
