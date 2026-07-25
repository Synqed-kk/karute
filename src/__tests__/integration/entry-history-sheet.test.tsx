/**
 * @jest-environment jsdom
 *
 * W2 one-sheet consolidation (2026-07-26, Liam-approved mock): the 編集履歴
 * block now lives INSIDE EntryEditSheet, above the category chips, fetched
 * only for a human-touched entry (author HUMAN_EDITED/HUMAN_CREATED) — a
 * plain AI entry gets no block and no fetch. The standalone
 * EntryHistorySheet, the 編集済み badge, and the sheet-mutual-exclusion
 * machinery are all deleted (Liam-approved: amber pencil is the only
 * edited-state signal now). This file — formerly entry-history-sheet.test.tsx
 * against the deleted component — is reworked to test the new home; the
 * mutual-exclusion + chip-tap tests are gone (moot, one sheet now), the
 * stale-view + rejection-belt tests are kept and adapted.
 * (next-intl mocked to echo keys, per the repo's tsx-test convention — see
 * entry-edit-sheet.test.tsx.)
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
import { EntryEditSheet } from '@/components/karute/redesign/detail/EntryEditSheet'

const editedEntry: SessionEntry = {
  id: 'e1',
  category: 'concern',
  time: '12:00',
  body: '肩の張りが続いている',
  version: 2,
  author: 'HUMAN_EDITED',
}

beforeEach(() => jest.clearAllMocks())

describe('CurrentSessionCard — pencil (W2 one-sheet)', () => {
  it('pencil tap on a HUMAN_EDITED entry opens the sheet and fetches this karute\'s trail', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<CurrentSessionCard sessionDate="d" entries={[editedEntry]} karuteRecordId="kar-1" />)
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalledWith('kar-1'))
  })

  it('pencil tap on a plain AI entry opens the sheet with NO history fetch', () => {
    const aiEntry: SessionEntry = { ...editedEntry, author: 'AI' }
    render(<CurrentSessionCard sessionDate="d" entries={[aiEntry]} karuteRecordId="kar-1" />)
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(listEntryEditHistory).not.toHaveBeenCalled()
  })

  it('pencil tap on an unauthored (legacy) entry opens the sheet with NO history fetch', () => {
    const legacyEntry: SessionEntry = { ...editedEntry, author: undefined }
    render(<CurrentSessionCard sessionDate="d" entries={[legacyEntry]} karuteRecordId="kar-1" />)
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(listEntryEditHistory).not.toHaveBeenCalled()
  })

  it('the pencil renders amber for a HUMAN_EDITED entry, pale for HUMAN_CREATED/AI', () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    const entries: SessionEntry[] = [
      editedEntry,
      { ...editedEntry, id: 'e2', author: 'HUMAN_CREATED' },
      { ...editedEntry, id: 'e3', author: 'AI' },
    ]
    render(<CurrentSessionCard sessionDate="d" entries={entries} karuteRecordId="kar-1" />)
    const pencils = screen.getAllByLabelText('entryEdit.editRow')
    expect(pencils[0].className).toContain('text-amber-600')
    expect(pencils[1].className).toContain('text-muted-foreground/40')
    expect(pencils[2].className).toContain('text-muted-foreground/40')
  })

  it('no 編集済み badge renders anywhere — the amber pencil is the only edited-state signal', () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<CurrentSessionCard sessionDate="d" entries={[editedEntry]} karuteRecordId="kar-1" />)
    expect(screen.queryByText('currentSession.chips.edited')).not.toBeInTheDocument()
  })

  it('permanent regression: save→reopen→history — an AI entry gets no fetch, saving flips it to HUMAN_EDITED, reopening the SAME entry fetches + renders its history (fix round)', async () => {
    const aiEntry: SessionEntry = {
      id: 'e1',
      category: 'concern',
      time: '12:00',
      body: 'original body',
      version: 2,
      author: 'AI',
    }
    updateKaruteDetailEntry.mockResolvedValue({ ok: true })

    render(<CurrentSessionCard sessionDate="d" entries={[aiEntry]} karuteRecordId="kar-1" />)

    // Open on the AI entry — no history fetch (its trail is pipeline noise).
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(screen.getByRole('textbox')).toHaveValue('original body')
    expect(listEntryEditHistory).not.toHaveBeenCalled()

    // Edit + save — the onSaved override flips AI → HUMAN_EDITED, sheet closes.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(updateKaruteDetailEntry).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())

    // Reopen the SAME entry — now human-touched, so the history block fetches
    // this record's trail and renders the returned row.
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'original body',
          contentAfter: 'edited body',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    fireEvent.click(screen.getByLabelText('entryEdit.editRow'))
    expect(screen.getByRole('textbox')).toHaveValue('edited body')
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalledWith('kar-1'))
    // The history row's "after" text (a <p>) is distinct from the card's own
    // bullet (a <span>), which now shows the same saved body — scope by tag.
    await waitFor(() => expect(screen.getByText('edited body', { selector: 'p' })).toBeInTheDocument())
  })
})

describe('EntryEditSheet — 編集履歴 block', () => {
  it('renders history rows above the category chips for a human-touched entry, filtered to it', async () => {
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
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('kept content')).toBeInTheDocument())
    expect(screen.queryByText('dropped content')).not.toBeInTheDocument()
    // The block sits ABOVE the category chips in DOM order.
    const historyRow = screen.getByText('kept content')
    const firstChip = screen.getByText('concern')
    expect(historyRow.compareDocumentPosition(firstChip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('a HUMAN_CREATED entry also fetches + renders the history block (not just HUMAN_EDITED)', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'CREATE',
          actorName: '田中',
          contentBefore: null,
          contentAfter: 'handwritten row',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(
      <EntryEditSheet
        karuteRecordId="kar-1"
        entry={{ ...editedEntry, author: 'HUMAN_CREATED' }}
        onOpenChange={jest.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('handwritten row')).toBeInTheDocument())
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
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('unknownStaff')).toBeInTheDocument())
  })

  it('error state renders the generic t(error), never the raw server string', async () => {
    listEntryEditHistory.mockResolvedValue({ error: 'RAW UPSTREAM TEXT' })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.queryByText('RAW UPSTREAM TEXT')).not.toBeInTheDocument()
  })

  it('a rejecting action promise resolves to the error state — never strands loading', async () => {
    listEntryEditHistory.mockRejectedValue(new Error('network down'))
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.queryByText('loading')).not.toBeInTheDocument()
  })

  it('empty state renders t(empty) when the filtered set is empty and not truncated', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })

  it('truncated + a filtered-empty result renders partial, never claims "no history"', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: true })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('partial')).toBeInTheDocument())
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
  })

  it('truncated + rows renders the partial line as a footer under the list', async () => {
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
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('a')).toBeInTheDocument())
    expect(screen.getByText('partial')).toBeInTheDocument()
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
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('legacy row')).toBeInTheDocument())
  })

  it('open A → close → open B shows loading, never paints A\'s stale rows', async () => {
    let resolveA: (v: unknown) => void = () => {}
    let resolveB: (v: unknown) => void = () => {}
    listEntryEditHistory
      .mockImplementationOnce(() => new Promise((resolve) => (resolveA = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolveB = resolve)))

    const entryA: SessionEntry = { ...editedEntry, id: 'A' }
    const entryB: SessionEntry = { ...editedEntry, id: 'B' }

    const { rerender } = render(
      <EntryEditSheet karuteRecordId="kar-1" entry={entryA} onOpenChange={jest.fn()} />,
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
    rerender(<EntryEditSheet karuteRecordId="kar-1" entry={null} onOpenChange={jest.fn()} />)
    rerender(<EntryEditSheet karuteRecordId="kar-1" entry={entryB} onOpenChange={jest.fn()} />)

    expect(screen.queryByText('A content')).not.toBeInTheDocument()
    expect(screen.getByText('loading')).toBeInTheDocument()

    resolveB({ edits: [], truncated: false })
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })

  it('reopening the SAME entry after a close shows loading, not the cached rows', async () => {
    let resolve1: (v: unknown) => void = () => {}
    let resolve2: (v: unknown) => void = () => {}
    listEntryEditHistory
      .mockImplementationOnce(() => new Promise((resolve) => (resolve1 = resolve)))
      .mockImplementationOnce(() => new Promise((resolve) => (resolve2 = resolve)))

    const { rerender } = render(
      <EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />,
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
    rerender(<EntryEditSheet karuteRecordId="kar-1" entry={null} onOpenChange={jest.fn()} />)
    rerender(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)

    expect(screen.queryByText('first content')).not.toBeInTheDocument()
    expect(screen.getByText('loading')).toBeInTheDocument()

    resolve2({ edits: [], truncated: false })
    await waitFor(() => expect(screen.getByText('empty')).toBeInTheDocument())
  })

  it('autoFocus is OFF for a human-touched entry — the history block sits above the textarea and must stay in view on open (fix round)', () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    expect(screen.getByRole('textbox')).not.toHaveFocus()
  })

  it('autoFocus stays ON for a plain AI entry — no history block, keyboard-on-tap unchanged (fix round)', () => {
    render(
      <EntryEditSheet
        karuteRecordId="kar-1"
        entry={{ ...editedEntry, author: 'AI' }}
        onOpenChange={jest.fn()}
      />,
    )
    expect(screen.getByRole('textbox')).toHaveFocus()
    expect(listEntryEditHistory).not.toHaveBeenCalled()
  })
})

describe('EntryEditSheet — keyboard fold (W2 one-sheet, 2026-07-26 packet)', () => {
  it('focusing the textarea on a human-touched entry folds history to the latest-row bar — no actor name, no timestamp region', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'old text',
          contentAfter: 'latest folded text',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('latest folded text')).toBeInTheDocument())

    fireEvent.focus(screen.getByRole('textbox'))

    // Full rows list (a <ul>, implicit role="list") is gone; the bar shows
    // the SAME latest text as the sole survivor.
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText('latest folded text')).toBeInTheDocument()
    // No name, no struck-through "before" text anywhere in the bar-only region.
    expect(screen.queryByText('田中')).not.toBeInTheDocument()
    expect(screen.queryByText('old text')).not.toBeInTheDocument()
  })

  it('tapping the folded bar blurs the textarea and restores the full history block', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'old text',
          contentAfter: 'latest text',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('latest text')).toBeInTheDocument())
    const textbox = screen.getByRole('textbox')
    fireEvent.focus(textbox)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('expand'))

    expect(textbox).not.toHaveFocus()
    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getByText('田中')).toBeInTheDocument()
  })

  it('while the view is still loading and the textarea is focused, the bar shows the loading text — never stale rows', () => {
    listEntryEditHistory.mockImplementationOnce(() => new Promise(() => {})) // never resolves
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)

    fireEvent.focus(screen.getByRole('textbox'))

    expect(screen.getByText('loading')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('focusing the textarea on a plain AI entry shows no history bar and never fetches (folding never applies)', () => {
    render(
      <EntryEditSheet
        karuteRecordId="kar-1"
        entry={{ ...editedEntry, author: 'AI' }}
        onOpenChange={jest.fn()}
      />,
    )
    fireEvent.focus(screen.getByRole('textbox'))

    expect(listEntryEditHistory).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('expand')).not.toBeInTheDocument()
  })

  it('the folded bar text carries the pinned line-clamp-2 default (the max-height:360px degrade to line-clamp-1 is a CSS media query, not jsdom-testable)', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'old text',
          contentAfter: 'latest text',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('latest text')).toBeInTheDocument())

    fireEvent.focus(screen.getByRole('textbox'))

    const bar = screen.getByText('latest text')
    expect(bar).toHaveClass('line-clamp-2', '[@media(max-height:360px)]:line-clamp-1')
  })

  it('save button and category chips prevent default on mousedown — the mid-tap fold-release guard', async () => {
    listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(listEntryEditHistory).toHaveBeenCalled())
    fireEvent.focus(screen.getByRole('textbox'))

    // fireEvent returns false when preventDefault was called — a blur-driven
    // unfold must never relayout the page mid-tap under these buttons.
    expect(fireEvent.mouseDown(screen.getByText('save'))).toBe(false)
    expect(fireEvent.mouseDown(screen.getByText('concern'))).toBe(false)
  })

  it('keyboard activation of the ▾ bar re-anchors focus onto the restored history block (never document.body)', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'ed-1',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'old text',
          contentAfter: 'latest text',
          createdAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(<EntryEditSheet karuteRecordId="kar-1" entry={editedEntry} onOpenChange={jest.fn()} />)
    await waitFor(() => expect(screen.getByText('latest text')).toBeInTheDocument())
    fireEvent.focus(screen.getByRole('textbox'))

    // Keyboard activation = click with no preceding mousedown. The bar
    // unmounts on unfold; the rAF must land focus on the block (tabIndex=-1).
    fireEvent.click(screen.getByLabelText('expand'))

    await waitFor(() => expect(screen.getByRole('list').parentElement).toHaveFocus())
  })
})
