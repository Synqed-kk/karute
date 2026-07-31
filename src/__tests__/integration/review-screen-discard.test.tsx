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
  // EntryCard (rendered whenever entries is non-empty — see the provenance
  // suite below) also reads the locale directly.
  useLocale: () => 'en',
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
import type { Entry } from '@/types/ai'

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
  ;(saveKaruteRecord as jest.Mock).mockResolvedValue(undefined)
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

/**
 * Save provenance (edit-layer Wave 1, packet PR-2a). Untouched AI entries
 * must save is_manual: false; a staff-edited or hand-added entry must save
 * is_manual: true. Dirty-tracking is keyed on the field array's stable id
 * (react-hook-form's useFieldArray `field.id`), never on array index — a
 * remove-then-add must not mis-promote an untouched neighbor that slid into
 * a different slot.
 */
describe('ReviewScreen save provenance', () => {
  const A: Entry = { category: 'symptom', title: 'A', source_quote: 'qa', confidence_score: 0.9 }
  const B: Entry = { category: 'treatment', title: 'B', source_quote: 'qb', confidence_score: 0.8 }
  const C: Entry = { category: 'other', title: 'C', source_quote: 'qc', confidence_score: 0.7 }

  function savedEntries() {
    const call = (saveKaruteRecord as jest.Mock).mock.calls[0][0]
    return call.entries as Array<{ content: string; isManual?: boolean }>
  }

  it('untouched AI entries save is_manual: false', async () => {
    render(<ReviewScreen {...baseProps} entries={[A, B]} />)
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(saveKaruteRecord).toHaveBeenCalledTimes(1))

    expect(savedEntries()).toEqual([
      expect.objectContaining({ content: 'A', isManual: false }),
      expect.objectContaining({ content: 'B', isManual: false }),
    ])
  })

  it('editing an entry flips it to is_manual: true; the untouched neighbor stays false', async () => {
    render(<ReviewScreen {...baseProps} entries={[A, B]} />)
    const titleInputs = screen.getAllByPlaceholderText('entryTitlePlaceholder')
    fireEvent.change(titleInputs[0], { target: { value: 'A-edited' } })

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(saveKaruteRecord).toHaveBeenCalledTimes(1))

    expect(savedEntries()).toEqual([
      expect.objectContaining({ content: 'A-edited', isManual: true }),
      expect.objectContaining({ content: 'B', isManual: false }),
    ])
  })

  it('a hand-added entry saves is_manual: true; existing entries are untouched', async () => {
    render(<ReviewScreen {...baseProps} entries={[A]} />)
    fireEvent.click(screen.getByRole('button', { name: 'addEntry' }))

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(saveKaruteRecord).toHaveBeenCalledTimes(1))

    const saved = savedEntries()
    expect(saved[0]).toEqual(expect.objectContaining({ content: 'A', isManual: false }))
    expect(saved[1]).toEqual(expect.objectContaining({ content: '', isManual: true }))
  })

  it('remove-then-add does not mis-promote a shifted neighbor into edited', async () => {
    render(<ReviewScreen {...baseProps} entries={[A, B, C]} />)

    // Remove B (index 1) — A and C slide, C now sits where B used to be.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove entry' })[1])
    // Append a new hand-added entry.
    fireEvent.click(screen.getByRole('button', { name: 'addEntry' }))

    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(saveKaruteRecord).toHaveBeenCalledTimes(1))

    expect(savedEntries()).toEqual([
      expect.objectContaining({ content: 'A', isManual: false }),
      // C must stay untouched even though it now occupies B's old slot.
      expect.objectContaining({ content: 'C', isManual: false }),
      expect.objectContaining({ content: '', isManual: true }),
    ])
  })
})
