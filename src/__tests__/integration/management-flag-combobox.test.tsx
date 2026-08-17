/** @jest-environment jsdom */
// StaffCombobox — the assignment picker that replaces the three plain
// <select>s (signed-off mock §②/§④). Rendered against the REAL ja.json.
//
// The rules under test, in the order they matter:
//   1. default list hides 経営メンバー — but never the viewer themselves, and
//      never whoever is already selected;
//   2. typing searches the WHOLE roster, so they stay fully assignable, and
//      revealed rows carry the 経営 chip;
//   3. selection resolves from the FULL prop array, so an assigned management
//      member's name is still what the closed box reads;
//   4. required mode reverts a half-typed query on blur (the value only ever
//      changes by picking a row); clearable mode pins 指名なし first.
//
// Plus the T1 misfile regression against the REAL NewBookingDialog: a
// management viewer's own id is seeded, visible, and submits under self —
// the #496 failure class (a select showing one identity while state holds
// another) must not come back through the hiding rule.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur.replace(/\{(\w+)\}/g, (_m, v: string) => String(vars?.[v] ?? `{${v}}`))
    },
  }
})
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }))
jest.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh: jest.fn() }) }))
jest.mock('@/actions/customers', () => ({ createQuickCustomer: jest.fn() }))
const createAppointment: jest.Mock = jest.fn(async () => ({ id: 'appt-1' }))
jest.mock('@/actions/appointments', () => ({
  createAppointment: (input: unknown) => createAppointment(input),
}))

import { StaffCombobox } from '@/components/karute/StaffCombobox'
import { NewBookingDialog } from '@/components/appointments/NewBookingDialog'

const SATO = { id: 'p-sato', name: '佐藤 美咲' }
const TANAKA = { id: 'p-tanaka', name: '田中 花' }
const KITANO = { id: 'p-kitano', name: '北野', isManagement: true }
const ROSTER = [SATO, TANAKA, KITANO]

function open() {
  fireEvent.focus(screen.getByRole('combobox'))
}
function rows() {
  return within(screen.getByRole('listbox')).getAllByRole('option')
}

describe('StaffCombobox — default list', () => {
  it('opens on FOCUS (not type-first) and omits 経営メンバー', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={null} onSelect={() => {}} />)
    expect(screen.queryByRole('listbox')).toBeNull()
    open()
    expect(rows().map((r) => r.textContent)).toEqual(['佐藤 美咲', '田中 花'])
  })

  it('the viewer themselves is ALWAYS listed, flagged or not', () => {
    render(
      <StaffCombobox staff={ROSTER} selectedId={null} onSelect={() => {}} selfId={KITANO.id} />,
    )
    open()
    expect(rows().map((r) => r.textContent)).toContain('北野経営')
  })

  it('an already-selected 経営メンバー stays listed and stays readable in the box', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={KITANO.id} onSelect={() => {}} />)
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('北野')
    open()
    expect(rows().some((r) => r.textContent?.startsWith('北野'))).toBe(true)
  })
})

describe('StaffCombobox — search reveal', () => {
  it('typing finds a 経営メンバー and tags the row 経営', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={null} onSelect={() => {}} />)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '北' } })
    const found = rows()
    expect(found).toHaveLength(1)
    expect(found[0].textContent).toBe('北野経営')
  })

  it('picking the revealed row reports their id', () => {
    const picked: string[] = []
    render(<StaffCombobox staff={ROSTER} selectedId={null} onSelect={(id) => picked.push(id)} />)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '北' } })
    fireEvent.mouseDown(rows()[0])
    expect(picked).toEqual([KITANO.id])
  })

  it('no match says so instead of rendering an empty box', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={null} onSelect={() => {}} />)
    open()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })
    expect(screen.getByText('結果が見つかりません')).toBeTruthy()
  })
})

describe('StaffCombobox — required vs clearable', () => {
  it('required: blur reverts a half-typed query to the last valid selection', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={SATO.id} onSelect={() => {}} />)
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '北' } })
    fireEvent.blur(input)
    expect(input.value).toBe('佐藤 美咲')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('clearable: 指名なし is pinned first on the default list and clears the value', () => {
    const picked: string[] = []
    render(
      <StaffCombobox
        staff={ROSTER}
        selectedId={null}
        onSelect={(id) => picked.push(id)}
        noneLabel="指名なし"
      />,
    )
    open()
    const all = rows()
    expect(all[0].textContent).toBe('指名なし')
    fireEvent.mouseDown(all[0])
    expect(picked).toEqual([''])
  })

  // B5(a) — the pre-filled name is a DISPLAYED VALUE, not a query. Opening on
  // an existing 指名 must show the whole default list, 指名なし included, the
  // way the <select> this replaced did. (Regression guard: gating purely on the
  // input text collapsed this to "only the person already chosen", making
  // clearing a 指名 unreachable on the first tap.)
  it('clearable with an existing 指名: pristine open shows the FULL list + 指名なし', () => {
    const picked: string[] = []
    render(
      <StaffCombobox
        staff={ROSTER}
        selectedId={SATO.id}
        onSelect={(id) => picked.push(id)}
        noneLabel="指名なし"
      />,
    )
    open()
    expect(rows().map((r) => r.textContent)).toEqual([
      '指名なし',
      '佐藤 美咲',
      '田中 花',
    ])
    fireEvent.mouseDown(rows()[0])
    expect(picked).toEqual([''])
  })

  it('required mode with a selection: pristine open still lists everyone', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={SATO.id} onSelect={() => {}} />)
    open()
    expect(rows().map((r) => r.textContent)).toEqual(['佐藤 美咲', '田中 花'])
  })

  it('required mode renders no 指名なし row', () => {
    render(<StaffCombobox staff={ROSTER} selectedId={SATO.id} onSelect={() => {}} />)
    open()
    expect(screen.queryByText('指名なし')).toBeNull()
  })

  // B5(b) — the FIRST KEYSTROKE is what turns the list into a search result.
  // From there 指名なし is not a match, so it goes.
  it('clearable: 指名なし disappears once they start typing, returns when cleared', () => {
    render(
      <StaffCombobox
        staff={ROSTER}
        selectedId={null}
        onSelect={() => {}}
        noneLabel="指名なし"
      />,
    )
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(rows()[0].textContent).toBe('指名なし')

    fireEvent.change(input, { target: { value: '北' } })
    expect(screen.queryByText('指名なし')).toBeNull()
    expect(rows().map((r) => r.textContent)).toEqual(['北野経営'])

    fireEvent.change(input, { target: { value: '' } })
    expect(rows()[0].textContent).toBe('指名なし')
  })

  it('editing an existing 指名 filters; blurring reverts to the pristine list', () => {
    render(
      <StaffCombobox
        staff={ROSTER}
        selectedId={SATO.id}
        onSelect={() => {}}
        noneLabel="指名なし"
      />,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '北' } })
    expect(screen.queryByText('指名なし')).toBeNull()
    expect(rows().map((r) => r.textContent)).toEqual(['北野経営'])

    // Blur reverts the text AND the dirty state — reopening is pristine again.
    fireEvent.blur(input)
    expect(input.value).toBe('佐藤 美咲')
    open()
    expect(rows()[0].textContent).toBe('指名なし')
  })
})

// B4 — every call site builds its `staff` array inline, so `selected` is a new
// object on every parent render. An effect keyed on that object wipes whatever
// is being typed the moment anything upstream re-renders (a sibling field, a
// fetch settling). The dep must be the NAME.
describe('StaffCombobox — typing survives a parent re-render', () => {
  it('a fresh-identity staff array mid-type does not reset the query', () => {
    const fresh = () => ROSTER.map((s) => ({ ...s }))
    const { rerender } = render(
      <StaffCombobox staff={fresh()} selectedId={SATO.id} onSelect={() => {}} />,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: '北' } })
    expect(input.value).toBe('北')

    // Same selection, brand-new array + row objects — the identity churn a
    // parent re-render produces.
    rerender(<StaffCombobox staff={fresh()} selectedId={SATO.id} onSelect={() => {}} />)
    expect(input.value).toBe('北')
    expect(rows().map((r) => r.textContent)).toEqual(['北野経営'])
  })

  it('a REAL selection change still re-seeds the box', () => {
    const { rerender } = render(
      <StaffCombobox staff={ROSTER} selectedId={SATO.id} onSelect={() => {}} />,
    )
    const input = screen.getByRole('combobox') as HTMLInputElement
    expect(input.value).toBe('佐藤 美咲')
    rerender(<StaffCombobox staff={ROSTER} selectedId={TANAKA.id} onSelect={() => {}} />)
    expect(input.value).toBe('田中 花')
  })
})

describe('T1 misfile regression — NewBookingDialog with a management viewer', () => {
  it('seeds their own id, shows their name, and books under self', async () => {
    render(
      <NewBookingDialog
        open
        onOpenChange={() => {}}
        customers={[{ id: 'cust-1', name: '山口 恵' }]}
        staff={ROSTER}
        selfStaffId={KITANO.id}
        initialStaffId={KITANO.id}
        initialClientId="cust-1"
        initialDate="2026-08-18"
        initialTime="11:00"
      />,
    )

    // The staff box shows the seeded identity — not blank, not someone else.
    const staffBox = screen
      .getAllByRole('combobox')
      .find((el) => (el as HTMLInputElement).value === '北野') as HTMLInputElement
    expect(staffBox).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(createAppointment).toHaveBeenCalled())
    expect(createAppointment.mock.calls[0][0]).toEqual(
      expect.objectContaining({ staffProfileId: KITANO.id }),
    )
  })
})
