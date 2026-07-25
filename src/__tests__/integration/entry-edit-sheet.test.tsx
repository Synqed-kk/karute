/**
 * @jest-environment jsdom
 *
 * Edit-layer W2 PR-B (fleet round): the row pencil's version-missing guard
 * (CurrentSessionCard) + the entry-edit sheet's seed/save/no-op/reopen
 * contract. (next-intl mocked to echo keys, per the repo's tsx-test
 * convention — see current-session-card.test.tsx.)
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// useLocale added alongside useTranslations: EntryEditSheet now folds in the
// 編集履歴 block (W2 one-sheet consolidation) and calls useLocale() for its
// date formatter.
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'ja' }))

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const updateKaruteDetailEntry = jest.fn()
// listEntryEditHistory: the one-sheet's history block fetches through this
// for a human-touched entry (HUMAN_EDITED/HUMAN_CREATED) — several tests
// below use author: 'HUMAN_CREATED', so this must resolve even though those
// tests don't assert on history content.
const listEntryEditHistory = jest.fn()
listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
jest.mock('@/actions/karute', () => ({
  updateKaruteDetailEntry: (...args: unknown[]) => updateKaruteDetailEntry(...args),
  listEntryEditHistory: (...args: unknown[]) => listEntryEditHistory(...args),
}))

import {
  CurrentSessionCard,
  type SessionEntry,
} from '@/components/karute/redesign/detail/CurrentSessionCard'
import { EntryEditSheet } from '@/components/karute/redesign/detail/EntryEditSheet'

const versionedEntry: SessionEntry = {
  id: 'e1',
  category: 'concern',
  time: '12:00',
  body: '肩の張りが続いている',
  version: 2,
}

beforeEach(() => jest.clearAllMocks())

describe('CurrentSessionCard — row pencil', () => {
  it('a version-missing row (legacy/cached DTO) refreshes instead of opening the sheet', () => {
    render(
      <CurrentSessionCard
        sessionDate="d"
        entries={[{ ...versionedEntry, version: undefined }]}
        karuteRecordId="kar-1"
      />,
    )
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('re-clicking the same row after a save seeds the sheet with the just-saved body (T7)', async () => {
    updateKaruteDetailEntry.mockResolvedValue({ ok: true })
    render(<CurrentSessionCard sessionDate="d" entries={[versionedEntry]} karuteRecordId="kar-1" />)
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(updateKaruteDetailEntry).toHaveBeenCalled())
    // The prop entry is still version 2 / original body (no real refetch in
    // this test) — a correct reopen must come from the card's override, not
    // the stale prop.
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('edited body'))
  })
})

describe('EntryEditSheet — save', () => {
  it('renders the entry seeded and fires save with the edited content + version', async () => {
    updateKaruteDetailEntry.mockResolvedValue({ ok: true })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={versionedEntry} onOpenChange={jest.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('肩の張りが続いている')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await Promise.resolve()
    expect(updateKaruteDetailEntry).toHaveBeenCalledWith('kar-1', 'e1', {
      content: 'edited body',
      category: undefined,
      expectedVersion: 2,
    })
  })

  it('no-op save (nothing changed) closes without calling the action (T5)', () => {
    const onOpenChange = jest.fn()
    render(<EntryEditSheet karuteRecordId="kar-1" entry={versionedEntry} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('save'))
    expect(updateKaruteDetailEntry).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('category-only fix on an already-empty row stays possible (verify round 2)', async () => {
    // Other write paths don't bound content, so empty-body rows exist. An
    // unchanged empty body is never sent — only an ACTIVE emptying blocks save.
    updateKaruteDetailEntry.mockResolvedValue({ ok: true })
    render(
      <EntryEditSheet
        karuteRecordId="kar-1"
        entry={{ ...versionedEntry, body: '' }}
        onOpenChange={jest.fn()}
      />,
    )
    expect(screen.getByText('save')).not.toBeDisabled()
    fireEvent.click(screen.getByText('note'))
    fireEvent.click(screen.getByText('save'))
    await waitFor(() =>
      expect(updateKaruteDetailEntry).toHaveBeenCalledWith('kar-1', 'e1', {
        content: undefined,
        category: 'note',
        expectedVersion: 2,
      }),
    )
  })

  it('actively emptying the content disables save', () => {
    render(<EntryEditSheet karuteRecordId="kar-1" entry={versionedEntry} onOpenChange={jest.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(screen.getByText('save')).toBeDisabled()
  })

  it('a THROWING action (transport rejection) clears saving and shows the error — never strands the sheet (Greptile P1)', async () => {
    updateKaruteDetailEntry.mockRejectedValue(new Error('network down'))
    render(<EntryEditSheet karuteRecordId="kar-1" entry={versionedEntry} onOpenChange={jest.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    // saving cleared → the button is enabled again for a retry.
    expect(screen.getByText('save')).not.toBeDisabled()
    expect(screen.queryByText('network down')).not.toBeInTheDocument()
  })

  it('a failed save renders the fixed localized error, never the raw server string (verify round 2)', async () => {
    updateKaruteDetailEntry.mockResolvedValue({ error: 'RAW UPSTREAM TEXT' })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={versionedEntry} onOpenChange={jest.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.queryByText('RAW UPSTREAM TEXT')).not.toBeInTheDocument()
  })

  it('onSaved carries the AI→HUMAN_EDITED author flip so the chip is immediate (verify round 2)', async () => {
    updateKaruteDetailEntry.mockResolvedValue({ ok: true })
    const onSaved = jest.fn()
    render(
      <EntryEditSheet
        karuteRecordId="kar-1"
        entry={{ ...versionedEntry, author: 'AI' }}
        onOpenChange={jest.fn()}
        onSaved={onSaved}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ author: 'HUMAN_EDITED', version: 3 }),
      ),
    )
  })

  it('a HUMAN_CREATED entry keeps its author through onSaved (no false flip)', async () => {
    updateKaruteDetailEntry.mockResolvedValue({ ok: true })
    const onSaved = jest.fn()
    render(
      <EntryEditSheet
        karuteRecordId="kar-1"
        entry={{ ...versionedEntry, author: 'HUMAN_CREATED' }}
        onOpenChange={jest.fn()}
        onSaved={onSaved}
      />,
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ author: 'HUMAN_CREATED' }),
      ),
    )
  })
})
