/**
 * @jest-environment jsdom
 *
 * Edit-layer W2 history-sheet packet: the 編集済み chip → EntryHistorySheet
 * contract. (next-intl mocked to echo keys, per the repo's tsx-test
 * convention — see entry-edit-sheet.test.tsx.)
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
    listEntryEditHistory.mockResolvedValue({ edits: [] })
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

  it('empty state renders t(empty) when the filtered set is empty', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [] })
    render(<EntryHistorySheet karuteRecordId="kar-1" entry={entry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })
})
