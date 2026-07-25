/**
 * @jest-environment jsdom
 *
 * Edit-layer W2 PR-B: the row pencil's version-missing guard (CurrentSessionCard)
 * + the entry-edit sheet's seed/save contract. (next-intl mocked to echo keys,
 * per the repo's tsx-test convention — see current-session-card.test.tsx.)
 */
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

const refresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

const updateKaruteDetailEntry = jest.fn()
jest.mock('@/actions/karute', () => ({
  updateKaruteDetailEntry: (...args: unknown[]) => updateKaruteDetailEntry(...args),
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
})
