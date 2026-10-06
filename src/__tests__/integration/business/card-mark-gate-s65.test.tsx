/** @jest-environment jsdom */
// R246: the picture's practice gate holds even when the old picker reports a late completion.
import { render, fireEvent, act, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReserveCardLookSection } from '@/app/[locale]/(business)/business/settings/ReserveCardLookSection'
import { PALETTE } from '@/business/lib/reserve-card/palette'
import type { MarkEvent } from '@/business/lib/store-page/card-mark'

let mockOnMark: ((e: MarkEvent) => void) | null = null
jest.mock('@/app/[locale]/(business)/business/settings/CardMarkBlock', () => ({
  CardMarkBlock: ({ onMark }: { onMark: (e: MarkEvent) => void }) => {
    mockOnMark = onMark
    return null
  },
}))
afterEach(() => { cleanup(); mockOnMark = null })

type Slots = { main: ReactNode; preview: ReactNode; viewButton: ReactNode }
const section = (practice: boolean) => (
  <ReserveCardLookSection
    look={{ storeLine: 'Test store', scopeLabel: 'all', value: '', palette: PALETTE, practice }}
    value=""
    onPick={() => {}}
    reduced
    render={(s: Slots) => (
      <div className="page pg-settings">
        <div className="st-read">{s.main}{s.viewButton}</div>
        {s.preview && <aside className="st-side-card">{s.preview}</aside>}
      </div>
    )}
  />
)

it.each([['home', 0, 2], ['store', 1, 1]] as const)(
  'R246 %s: a picked event after practice flips off cannot enter the phone picture', (_view, index, marks) => {
    const r = render(section(true))
    const onMark = mockOnMark!
    expect(onMark).toEqual(expect.any(Function))
    fireEvent.click(document.querySelectorAll('.cl-preview .sp-seg button')[index])
    act(() => { onMark({ cause: 'picked', mark: { url: 'blob:early', width: 64, height: 64 } }) })
    expect(document.querySelectorAll('.cl-phone img[data-logo]')).toHaveLength(marks)
    r.rerender(section(false))
    expect(document.querySelector('.cl-phone')).not.toBeNull()
    expect(document.querySelectorAll('.cl-phone img[data-logo]')).toHaveLength(0)
    act(() => { onMark({ cause: 'picked', mark: { url: 'blob:late', width: 64, height: 64 } }) })
    expect(document.querySelectorAll('.cl-phone img[data-logo]')).toHaveLength(0)
  },
)
