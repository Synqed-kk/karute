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
let mockTarget: { customerId: string } | null = null
const push = jest.fn()

jest.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, back: jest.fn() }),
}))
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
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
