/**
 * @jest-environment jsdom
 *
 * Edit-layer W2 history-sheet packet: the 編集済み chip → EntryHistorySheet
 * contract. (next-intl mocked to echo keys, per the repo's tsx-test
 * convention — see entry-edit-sheet.test.tsx.)
 *
 * Fix round (blind 4-lens review): the keyed-view fix (no stale-entry flash,
 * no empty-before-loading flash), the rejection belt (#615 precedent), and
 * the truncated/partial-copy contract.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'ja',
}))

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const updateKaruteDetailEntry = jest.fn()
const listEntryEditHistory = jest.fn()
jest.mock('@/actions/karute', () => ({
  updateKaruteDetailEntry: (...args: unknown[]) => updateKaruteDetailEntry(...args),
  listEntryEditHistory: (...args: unknown[]) => listEntryEditHistory(...args),
}))

import {
  CurrentSessionCard,
  type SessionEntry,
} from '@/components/karute/redesign/detail/CurrentSessionCard'
import { EntryHistorySheet } from '@/components/karute/redesign/detail/EntryHistorySheet'

const editedEntry: SessionEntry = {
  id: 'e1',
  category: 'concern',
  time: '12:00',
  body: '肩の張りが続いている',
  version: 2,
  author: 'HUMAN_EDITED',
}

beforeEach(() => jest.clearAllMocks())

describe('CurrentSessionCard — 編集済み chip', () => {
  it('is a plain inert span when karuteRecordId is absent (no click handler)', () => {
    render(<CurrentSessionCard sessionDate="d" entries={[editedEntry]} />)
    const chip = screen.getByText('currentSession.chips.edited')
    expect(chip.tagName).toBe('SPAN')
  })

  it('tapping the chip opens the history sheet and fetches this karute\'s trail', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<CurrentSessionCard sessionDate="d" entries={[editedEntry]} karuteRecordId="kar-1" />)
    const chip = screen.getByText('currentSession.chips.edited')
    expect(chip.tagName).toBe('BUTTON')
    fireEvent.click(chip)
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalledWith('kar-1'))
    // The sheet mounted (title only renders once Sheet's `open` derives true).
    expect(screen.getByText('title')).toBeInTheDocument()
  })
})

describe('EntryHistorySheet', () => {
  const entry: SessionEntry = { id: 'e1', category: 'concern', time: '12:00', body: 'x' }

  it('filters the karute-wide trail down to rows that touch the tapped entry', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'CREATE',
          actorName: '田中',
          contentBefore: null,
          contentAfter: 'kept content',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
        {
          id: 'ed-2',
          entryIdOld: 'OTHER',
          entryIdNew: 'OTHER',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'x',
          contentAfter: 'dropped content',
          createdAt: '2026-07-21T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('kept content')).toBeInTheDocument())
    expect(screen.queryByText('dropped content')).not.toBeInTheDocument()
  })

  it('unknownStaff fallback when actorName is null', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'CREATE',
          actorName: null,
          contentBefore: null,
          contentAfter: 'a',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('unknownStaff')).toBeInTheDocument())
  })

  it('error state renders the generic t(error), never the raw server string', async () => {
    listEntryEditHistory.mockResolvedValue({ error: 'RAW UPSTREAM TEXT' })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.queryByText('RAW UPSTREAM TEXT')).not.toBeInTheDocument()
  })

  it('empty state renders t(empty) when the filtered set is empty and not truncated', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })

  it('a null action (legacy-null row) renders fine — action has no dedicated UI', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: null,
          actorName: '田中',
          contentBefore: null,
          contentAfter: 'legacy row',
          createdAt: '2026-06-01T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('legacy row')).toBeInTheDocument())
  })

  it('a rejecting action promise resolves to the error state — never strands loading (fix round #2)', async () => {
    listEntryEditHistory.mockRejectedValue(new Error('network down'))
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.queryByText('loading')).not.toBeInTheDocument()
  })

  it('truncated + a filtered-empty result renders partial, never claims "no history" (fix round #3)', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: true })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('partial')).toBeInTheDocument())
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
  })

  it('truncated + rows renders the partial line as a footer under the list (fix round #3)', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'CREATE',
          actorName: '田中',
          contentBefore: null,
          contentAfter: 'a',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: true,
    })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())
    expect(screen.getByText('partial')).toBeInTheDocument()
  })

  it('open A → close → open B shows loading, never paints A\'s stale rows (fix round #1)', async () => {
    let resolveA: (v: unknown) => void = () => {}
    let resolveB: (v: unknown) => void = () => {}
    listEntryEditHistory
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveB = resolve)))

    const entryA: SessionEntry = { id: 'A', category: 'concern', time: '12:00', body: 'a' }
    const entryB: SessionEntry = { id: 'B', category: 'concern', time: '12:00', body: 'b' }

    const { rerender } = render(
      <EntryHistorySheet karuteRecordId="kar-1" entry={entryA} onOpenChange={jest.fn()} />,
    )
    resolveA({
      edits: [
        {
          id: 'ed-a',
          entryIdOld: null,
          entryIdNew: 'A',
          action: 'CREATE',
          actorName: '田中',
          contentBefore: null,
          contentAfter: 'A content',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    await waitFor(() => expect(screen.getByText('A content')).toBeInTheDocument())

    // Close, then open a DIFFERENT entry — the second fetch is still pending.
    rerender(<EntryHistorySheet karuteRecordId="kar-1" entry={null} onOpenChange={jest.fn()} />)
    rerender(<EntryHistorySheet karuteRecordId="kar-1" entry={entryB} onOpenChange={jest.fn()} />)

    expect(screen.queryByText('A content')).not.toBeInTheDocument()
    expect(screen.getByText('loading')).toBeInTheDocument()

    resolveB({ edits: [], truncated: false })
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })

  it('reopening the SAME entry after a close shows loading, not the cached rows (fix round 2, small close 1)', async () => {
    let resolve1: (v: unknown) => void = () => {}
    let resolve2: (v: unknown) => void = () => {}
    listEntryEditHistory
      .mockImplementationOnce(() => new Promise((resolve) => (resolve1 = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolve2 = resolve)))

    const { rerender } = render(
      <EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />,
    )
    resolve1({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'CREATE',
          actorName: '田中',
          contentBefore: null,
          contentAfter: 'first content',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    await waitFor(() => expect(screen.getByText('first content')).toBeInTheDocument())

    // Close, then reopen the SAME entry — a fresh fetch for it is pending.
    rerender(<EntryHistorySheet karuteRecordId="kar-1" entry={null} onOpenChange={jest.fn()} />)
    rerender(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)

    expect(screen.queryByText('first content')).not.toBeInTheDocument()
    expect(screen.getByText('loading')).toBeInTheDocument()

    resolve2({ edits: [], truncated: false })
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })
})

describe('CurrentSessionCard — sheet mutual exclusion (fix round 2, small close 2)', () => {
  it('pencil-open then chip-tap → only the history sheet stays open', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<CurrentSessionCard sessionDate="d" entries={[editedEntry]} karuteRecordId="kar-1" />)

    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()

    fireEvent.click(screen.getByText('currentSession.chips.edited'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalledWith('kar-1'))
  })

  it('chip-open then pencil-tap → only the edit sheet stays open', async () => {
    let resolveHistory: (v: unknown) => void = () => {}
    listEntryEditHistory.mockImplementationOnce(() => new Promise((resolve) => (resolveHistory = resolve)))
    render(<CurrentSessionCard sessionDate="d" entries={[editedEntry]} karuteRecordId="kar-1" />)

    fireEvent.click(screen.getByText('currentSession.chips.edited'))
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalledWith('kar-1'))
    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    // The history sheet closed — its pending fetch's effect was cancelled,
    // so its loading text is gone (not swapped for empty/error).
    expect(screen.queryByText('loading')).not.toBeInTheDocument()

    resolveHistory({ edits: [], truncated: false })
  })
})
