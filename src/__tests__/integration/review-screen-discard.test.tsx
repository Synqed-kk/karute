/**
 * @jest-environment jsdom
 *
 * ReviewScreen discard + reset-on-save (PR #127 review follow-up).
 *
 * The background pipeline's review state previously had only a save path, and
 * even save never cleared the pipeline because saveKaruteRecord redirects by
 * throwing NEXT_REDIRECT (so the old onSaved was dead). Two fixes are covered:
 *   1. an optional onDiscard prop renders a Discard button that bails out
 *   2. onSaved fires on the NEXT_REDIRECT success branch so the chip is reset
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/actions/karute', () => ({
  saveKaruteRecord: jest.fn(),
}))

// ReviewScreen now pre-checks consent (handleSave) before saving. '@/actions/
// customers' is a 'use server' module (pulls in next/cache) that isn't safe to
// load for real under jsdom — mock it with a current-version consent so the
// discard/save-path tests below reach saveKaruteRecord untouched.
jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))

// None of the tests below ever get consent to go stale, so the dialog never
// opens — stub it out rather than loading it for real, since it (transitively)
// imports @synqed-kk/ui, an ESM package outside this suite's transform config.
jest.mock('@/components/karute/redesign/record/RecordingConsentDialog', () => ({
  RecordingConsentDialog: () => null,
}))

import { ReviewScreen } from '@/components/review/ReviewScreen'
import { saveKaruteRecord } from '@/actions/karute'

const customers = [{ id: 'c1', name: 'Test Customer' }]

const baseProps = {
  transcript: 'hello',
  entries: [],
  summary: 'a summary',
  customers,
  appointmentCustomerId: 'c1', // pre-attributed → no combobox, save enabled
  onSaved: jest.fn(),
}

// ReviewScreen fetches AI suggestions on mount; stub it out.
beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => ({ suggestions: [] }),
  }) as unknown as typeof fetch
})

// In production saveKaruteRecord redirects by throwing NEXT_REDIRECT, which
// ReviewScreen re-throws for Next.js to catch and navigate. There's no Next
// boundary in jsdom, so that expected re-throw floats out of the un-awaited
// onClick handler. Temporarily take over unhandledRejection (jest-circus would
// otherwise fail the test) so we can assert the side effect we care about.
async function withSwallowedRejections(fn: () => Promise<void>) {
  const prior = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', () => {})
  try {
    await fn()
  } finally {
    process.removeAllListeners('unhandledRejection')
    prior.forEach((h) => process.on('unhandledRejection', h))
  }
}

describe('ReviewScreen discard path', () => {
  it('renders a Discard button and calls onDiscard when clicked', () => {
    const onDiscard = jest.fn()
    render(<ReviewScreen {...baseProps} onDiscard={onDiscard} />)

    const discard = screen.getByRole('button', { name: 'discard' })
    fireEvent.click(discard)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it('does not render a Discard button when onDiscard is omitted', () => {
    render(<ReviewScreen {...baseProps} />)
    expect(screen.queryByRole('button', { name: 'discard' })).toBeNull()
  })

  it('calls onSaved on the NEXT_REDIRECT success branch (clears the chip)', async () => {
    ;(saveKaruteRecord as jest.Mock).mockRejectedValueOnce(
      new Error('NEXT_REDIRECT;/en/karute/new-id'),
    )
    const onSaved = jest.fn()
    render(<ReviewScreen {...baseProps} onSaved={onSaved} />)

    await withSwallowedRejections(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'save' }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    })
    expect(saveKaruteRecord).toHaveBeenCalledTimes(1)
  })
})
