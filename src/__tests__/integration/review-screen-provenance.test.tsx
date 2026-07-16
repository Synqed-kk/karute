/**
 * @jest-environment jsdom
 *
 * ReviewScreen / EntryCard provenance (edit-layer PR-2). Human edits + hand-adds
 * must reach the save as is_manual, and the flag must ride the row VALUE so it
 * survives useFieldArray index shifts (the reason promotion is edit-time, not a
 * submit-time dirtyFields lookup). Mirrors review-screen-discard.test.tsx.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useForm } from 'react-hook-form'
import { RECORDING_CONSENT_POLICY_VERSION } from '@/lib/consent'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}))

jest.mock('@/actions/karute', () => ({
  saveKaruteRecord: jest.fn(),
}))

jest.mock('@/actions/customers', () => ({
  getCustomerConsent: jest.fn(async () => ({
    consent: { policy_version: RECORDING_CONSENT_POLICY_VERSION, granted_at: '2026-07-01T00:00:00Z' },
  })),
  grantCustomerConsent: jest.fn(async () => ({ ok: true })),
}))

jest.mock('@/components/karute/redesign/record/RecordingConsentDialog', () => ({
  RecordingConsentDialog: () => null,
}))

import { ReviewScreen } from '@/components/review/ReviewScreen'
import { EntryCard } from '@/components/review/EntryCard'
import { saveKaruteRecord } from '@/actions/karute'
import type { Entry } from '@/types/ai'

const customers = [{ id: 'c1', name: 'Test Customer' }]
const baseProps = {
  transcript: 'hello',
  entries: [] as Entry[],
  summary: 'a summary',
  customers,
  appointmentCustomerId: 'c1', // pre-attributed → save enabled, no combobox
  onSaved: jest.fn(),
}
const ai = (title: string): Entry => ({ category: 'symptom', title, source_quote: '', confidence_score: 0.9 })

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ suggestions: [] }) }) as unknown as typeof fetch
})

const savedEntries = async () => {
  await waitFor(() => expect(saveKaruteRecord).toHaveBeenCalledTimes(1))
  return (saveKaruteRecord as jest.Mock).mock.calls[0][0].entries as Array<Record<string, unknown>>
}

describe('ReviewScreen provenance', () => {
  it('a hand-added entry saves as human (isManual true, confidence null)', async () => {
    render(<ReviewScreen {...baseProps} entries={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'addEntry' }))
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    const entries = await savedEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ isManual: true, confidenceScore: null })
  })

  it('an edited AI entry saves as human (isManual true)', async () => {
    render(<ReviewScreen {...baseProps} entries={[ai('X')]} />)
    fireEvent.change(screen.getByPlaceholderText('entryTitlePlaceholder'), { target: { value: 'X edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    const entries = await savedEntries()
    expect(entries[0]).toMatchObject({ content: 'X edited', isManual: true })
  })

  it('an untouched AI entry saves as AI (isManual false)', async () => {
    render(<ReviewScreen {...baseProps} entries={[ai('X')]} />)
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    const entries = await savedEntries()
    expect(entries[0]).toMatchObject({ content: 'X', isManual: false })
  })

  // MANDATORY: edit B, remove A, submit — B's promotion must travel to its new
  // index while the shifted-down untouched C stays AI. A submit-time dirtyFields
  // lookup would mis-promote C here; the value-carried flag does not.
  it('promotion survives a remove() index shift (edit B, remove A)', async () => {
    render(<ReviewScreen {...baseProps} entries={[ai('A'), ai('B'), ai('C')]} />)
    fireEvent.change(screen.getAllByPlaceholderText('entryTitlePlaceholder')[1], { target: { value: 'B edited' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove entry' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    const entries = await savedEntries()
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.content === 'B edited')).toMatchObject({ isManual: true })
    expect(entries.find((e) => e.content === 'C')).toMatchObject({ isManual: false })
  })
})

// EntryCard confidence badge keys on provenance, never the number alone.
function CardHarness({ entry }: { entry: Record<string, unknown> }) {
  const { control } = useForm({ defaultValues: { entries: [entry] } })
  return <EntryCard index={0} control={control} onRemove={() => {}} />
}

describe('EntryCard confidence badge', () => {
  it('shows the % badge for an AI row', () => {
    render(<CardHarness entry={{ category: 'symptom', title: 'x', source_quote: '', confidence_score: 0.9, is_manual: false }} />)
    expect(screen.getByText('90%')).toBeTruthy()
  })
  it('hides the badge for a manual row even when confidence is a number (0)', () => {
    render(<CardHarness entry={{ category: 'symptom', title: 'x', source_quote: '', confidence_score: 0, is_manual: true }} />)
    expect(screen.queryByText(/%/)).toBeNull()
  })
  it('hides the badge when confidence is null', () => {
    render(<CardHarness entry={{ category: 'symptom', title: 'x', source_quote: '', confidence_score: null, is_manual: false }} />)
    expect(screen.queryByText(/%/)).toBeNull()
  })
})
