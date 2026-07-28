/**
 * @jest-environment jsdom
 *
 * Edit-layer W2 summary half (the 詳細記録 pencil): the card's pencil
 * affordance + the summary-edit sheet's seed/save/no-op/reopen contract, the
 * record-level history filter, and the #640 keyboard-aware position carried
 * over from EntryEditSheet. (next-intl mocked to echo keys, per the repo's
 * tsx-test convention — see entry-edit-sheet.test.tsx.)
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'ja' }))

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const updateKaruteDetailSummary = jest.fn()
const listEntryEditHistory = jest.fn()
listEntryEditHistory.mockResolvedValue({ edits: [], truncated: false })
jest.mock('@/actions/karute', () => ({
  updateKaruteDetailSummary: (...args: unknown[]) => updateKaruteDetailSummary(...args),
  listEntryEditHistory: (...args: unknown[]) => listEntryEditHistory(...args),
}))

import { AISummaryCard } from '@/components/karute/redesign/detail/AISummaryCard'
import { SummaryEditSheet } from '@/components/karute/redesign/detail/SummaryEditSheet'

const RAW = '・肩の張りが続いている\n・次回は2週間後'
const BULLETS = ['肩の張りが続いている', '次回は2週間後']

beforeEach(() => jest.clearAllMocks())

describe('AISummaryCard — the 詳細記録 pencil', () => {
  it('renders read-only (no pencil) when the caller predates the pencil props', () => {
    render(<AISummaryCard sessionDate="d" bullets={BULLETS} />)
    expect(screen.queryByLabelText('summaryEdit.editButton')).not.toBeInTheDocument()
  })

  it('quiet pencil for an untouched AI summary; amber only when edited', () => {
    const { rerender } = render(
      <AISummaryCard
        sessionDate="d"
        bullets={BULLETS}
        karuteRecordId="kar-1"
        summaryRaw={RAW}
        summaryEdited={false}
      />,
    )
    expect(screen.getByLabelText('summaryEdit.editButton')).toHaveClass('text-muted-foreground/40')
    rerender(
      <AISummaryCard
        sessionDate="d"
        bullets={BULLETS}
        karuteRecordId="kar-1"
        summaryRaw={RAW}
        summaryEdited={true}
      />,
    )
    expect(screen.getByLabelText('summaryEdit.editButton')).toHaveClass('text-amber-600')
  })

  it('tap → sheet opens seeded with the RAW text (line breaks intact), save writes it', async () => {
    updateKaruteDetailSummary.mockResolvedValue({ ok: true })
    render(
      <AISummaryCard
        sessionDate="d"
        bullets={BULLETS}
        karuteRecordId="kar-1"
        summaryRaw={RAW}
        summaryEdited={false}
      />,
    )
    fireEvent.click(screen.getByLabelText('summaryEdit.editButton'))
    expect(screen.getByRole('textbox')).toHaveValue(RAW)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '・直した行\n・次回は2週間後' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() =>
      expect(updateKaruteDetailSummary).toHaveBeenCalledWith('kar-1', {
        content: '・直した行\n・次回は2週間後',
      }),
    )
  })

  it('after a save the card repaints from the override: new bullets, amber pencil, reopen seeds the just-saved text (T7)', async () => {
    updateKaruteDetailSummary.mockResolvedValue({ ok: true })
    render(
      <AISummaryCard
        sessionDate="d"
        bullets={BULLETS}
        karuteRecordId="kar-1"
        summaryRaw={RAW}
        summaryEdited={false}
      />,
    )
    fireEvent.click(screen.getByLabelText('summaryEdit.editButton'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '・直した行' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(updateKaruteDetailSummary).toHaveBeenCalled())
    // The props are still the stale server values (no real refetch here) — a
    // correct repaint must come from the card's override, not the props.
    await waitFor(() => expect(screen.getByText('直した行')).toBeInTheDocument())
    expect(screen.queryByText('肩の張りが続いている')).not.toBeInTheDocument()
    expect(screen.getByLabelText('summaryEdit.editButton')).toHaveClass('text-amber-600')
    fireEvent.click(screen.getByLabelText('summaryEdit.editButton'))
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('・直した行'))
    expect(refresh).toHaveBeenCalled()
  })
})

describe('SummaryEditSheet — save contract', () => {
  const baseProps = {
    karuteRecordId: 'kar-1',
    open: true,
    onOpenChange: jest.fn(),
    seed: RAW,
    edited: false,
  }

  it('no-op save (nothing changed) closes without calling the action', () => {
    const onOpenChange = jest.fn()
    render(<SummaryEditSheet {...baseProps} onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByText('save'))
    expect(updateKaruteDetailSummary).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('emptied content disables save — the summary can never be blanked from here', () => {
    render(<SummaryEditSheet {...baseProps} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(screen.getByText('save')).toBeDisabled()
  })

  it('a returned {error} renders the error key and keeps the sheet open', async () => {
    updateKaruteDetailSummary.mockResolvedValue({ error: 'boom' })
    const onOpenChange = jest.fn()
    render(<SummaryEditSheet {...baseProps} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    // The raw server string must never render (sibling convention).
    expect(screen.queryByText('boom')).not.toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('a THROWING action is caught — sheet shows the error, saving state releases', async () => {
    updateKaruteDetailSummary.mockRejectedValue(new Error('transport'))
    render(<SummaryEditSheet {...baseProps} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } })
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.getByText('error')).toBeInTheDocument())
    expect(screen.getByText('save')).not.toBeDisabled()
  })
})

describe('SummaryEditSheet — record-level history (edited summaries only)', () => {
  it('does not fetch history for an untouched AI summary', () => {
    render(
      <SummaryEditSheet
        karuteRecordId="kar-1"
        open={true}
        onOpenChange={jest.fn()}
        seed={RAW}
        edited={false}
      />,
    )
    expect(listEntryEditHistory).not.toHaveBeenCalled()
  })

  it('fetches for an edited summary and renders ONLY record-level rows (both entry ids null)', async () => {
    listEntryEditHistory.mockResolvedValue({
      edits: [
        {
          id: 'row-entry',
          entryIdOld: null,
          entryIdNew: 'e1',
          action: 'EDIT',
          actorName: '田中',
          contentBefore: 'エントリー前',
          contentAfter: 'エントリー後',
          createdAt: '2026-07-29T10:00:00.000Z',
        },
        {
          id: 'row-summary',
          entryIdOld: null,
          entryIdNew: null,
          action: 'EDIT',
          actorName: '田中',
          contentBefore: '要約の前',
          contentAfter: '要約の後',
          createdAt: '2026-07-29T11:00:00.000Z',
        },
      ],
      truncated: false,
    })
    render(
      <SummaryEditSheet
        karuteRecordId="kar-1"
        open={true}
        onOpenChange={jest.fn()}
        seed={RAW}
        edited={true}
      />,
    )
    await waitFor(() => expect(screen.getByText('要約の後')).toBeInTheDocument())
    expect(screen.getByText('要約の前')).toBeInTheDocument()
    // The per-entry row must NOT leak into the summary's own trail.
    expect(screen.queryByText('エントリー後')).not.toBeInTheDocument()
  })
})

describe('SummaryEditSheet — keyboard-aware position (#640 carried over)', () => {
  class FakeViewport extends EventTarget {
    height = 800
    offsetTop = 0
  }
  let vv: FakeViewport

  const sheet = () => {
    const el = document.querySelector('[data-slot="sheet-content"]') as HTMLElement | null
    if (!el) throw new Error('sheet content not mounted')
    return el
  }

  beforeEach(() => {
    vv = new FakeViewport()
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true, writable: true })
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  })
  afterEach(() => {
    // Restore jsdom's real absence — the rest of the file depends on the
    // guard path (no visualViewport → hook no-ops).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).visualViewport
  })

  const openSheet = () =>
    render(
      <SummaryEditSheet
        karuteRecordId="kar-1"
        open={true}
        onOpenChange={jest.fn()}
        seed={RAW}
        edited={false}
      />,
    )

  it('lifts the sheet by the keyboard occlusion and caps its height to the visible space', () => {
    openSheet()
    act(() => {
      vv.height = 500
      vv.dispatchEvent(new Event('resize'))
    })
    expect(sheet().style.bottom).toBe('300px')
    expect(sheet().style.maxHeight).toBe('min(85vh, 500px)')
    act(() => {
      vv.height = 800
      vv.dispatchEvent(new Event('resize'))
    })
    expect(sheet().style.bottom).toBe('')
    expect(sheet().style.maxHeight).toBe('')
  })

  it('iOS visual-viewport pan (offsetTop) counts toward the occlusion via the scroll listener', () => {
    openSheet()
    act(() => {
      vv.height = 500
      vv.offsetTop = 100
      vv.dispatchEvent(new Event('scroll'))
    })
    // 800 − 500 − 100: the panned-away top is not keyboard occlusion.
    expect(sheet().style.bottom).toBe('200px')
    // The height cap is the VISUAL height, not layout-minus-inset (Greptile
    // #640) — an inset-derived cap would hide the sheet's top above the pan.
    expect(sheet().style.maxHeight).toBe('min(85vh, 500px)')
  })

  it('without visualViewport the sheet keeps its class anchor (guard path)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).visualViewport
    openSheet()
    expect(sheet().style.bottom).toBe('')
  })
})
