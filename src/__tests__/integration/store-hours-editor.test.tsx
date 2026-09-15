/** @jest-environment jsdom */
// 1c-D S3 — the 営業時間 editor in the 店舗 row. Pins the three things that
// protect the owner from the shape of this data:
//   · a store with no hours of its own SAYS so and pre-fills from the
//     business-wide hours, marked NOT YET SAVED — the starting point must
//     never read as this store's truth.
//   · flipping a weekday to 休業 asks first and names what stops; only that
//     direction asks.
//   · 保存 is closed until all seven rows are valid, judged by the SAME
//     parseStoreWeeklyHours the server gate runs, and the payload it sends
//     always carries seven weekdays.
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

jest.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'ja',
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
const setStoreHours = jest.fn(async () => ({ ok: true }) as { ok: true } | { error: string })
const listStoresWithHours = jest.fn(async () => [] as unknown[])
const updateStore = jest.fn(async () => ({ ok: true }))
jest.mock('@/actions/stores', () => ({
  setStoreHours: (...a: unknown[]) => setStoreHours(...(a as [])),
  listStoresWithHours: () => listStoresWithHours(),
  updateStore: (...a: unknown[]) => updateStore(...(a as [])),
  createStore: jest.fn(async () => ({ id: 'store-new' })),
  setActiveStore: jest.fn(async () => ({ ok: true })),
  getActiveStoreId: jest.fn(async () => null),
}))
jest.mock('@/actions/entitlements', () => ({ getEntitlement: jest.fn(async () => null) }))
jest.mock('@/components/settings/redesign/sections/stores/AddStoreSubscriptionDialog', () => ({
  AddStoreSubscriptionDialog: () => null,
}))
jest.mock('@/components/settings/redesign/sections/stores/PlanComparisonDialog', () => ({
  PlanComparisonDialog: () => null,
}))
// Stands in for the rename dialog: one button that fires the same onSave the
// real form fires, which is what makes StoresSection.refresh() run.
jest.mock('@/components/settings/redesign/sections/stores/StoreFormDialog', () => ({
  StoreFormDialog: ({
    mode,
    onSave,
  }: {
    mode: unknown
    onSave: (v: Record<string, string>) => void
  }) =>
    mode ? (
      <button onClick={() => onSave({ name: '別名', address: '', phone: '', businessType: '' })}>
        submit-rename
      </button>
    ) : null,
}))

import { StoreHoursBlock } from '@/components/settings/redesign/sections/stores/StoreHoursBlock'
import { StoresSection } from '@/components/settings/redesign/sections/StoresSection'
import type { OperatingHours } from '@/lib/operating-hours'

const ORG_HOURS: OperatingHours = {
  mon: { openMinute: 600, closeMinute: 1170 }, // 10:00–19:30
  tue: { openMinute: 600, closeMinute: 1170 },
  wed: { openMinute: 600, closeMinute: 1170 },
  thu: { openMinute: 600, closeMinute: 1170 },
  fri: { openMinute: 600, closeMinute: 1260 }, // 10:00–21:00
  sat: { openMinute: 540, closeMinute: 1080 }, // 09:00–18:00
  sun: { openMinute: 600, closeMinute: 1440 }, // 10:00–24:00 (the default close)
}

const OWN_WEEK = {
  mon: { open: '11:00', close: '20:00' },
  tue: null,
  wed: { open: '11:00', close: '20:00' },
  thu: { open: '11:00', close: '20:00' },
  fri: { open: '11:00', close: '20:00' },
  sat: { open: '10:00', close: '19:00' },
  sun: { open: '10:00', close: '18:00' },
}

function open(props: Partial<React.ComponentProps<typeof StoreHoursBlock>> = {}) {
  const utils = render(
    <StoreHoursBlock
      storeId="store-7"
      storeName="テスト店"
      weeklyHours={null}
      orgHours={ORG_HOURS}
      {...props}
    />,
  )
  fireEvent.click(screen.getByText('title'))
  return utils
}

function timeInputs(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="time"]'))
}

beforeEach(() => {
  jest.clearAllMocks()
  setStoreHours.mockResolvedValue({ ok: true })
  updateStore.mockResolvedValue({ ok: true })
  listStoresWithHours.mockResolvedValue([])
})

describe('a store that has never set its own hours', () => {
  it('says it is on the company-wide default and pre-fills the seven rows from it, marked unsaved', () => {
    const { container } = open()
    expect(screen.getByText('usingDefault')).toBeInTheDocument()
    expect(screen.getByText('usingDefaultHint')).toBeInTheDocument()
    const inputs = timeInputs(container)
    expect(inputs).toHaveLength(14)
    expect(inputs[0].value).toBe('10:00') // mon open
    expect(inputs[1].value).toBe('19:30') // mon close
    expect(inputs[9].value).toBe('21:00') // fri close
    expect(inputs[10].value).toBe('09:00') // sat open
  })

  it("the default's 24:00 close is clamped to 23:59 for the field — a time input cannot hold 24:00", () => {
    const { container } = open()
    expect(timeInputs(container)[13].value).toBe('23:59') // sun close
  })

  // R1-5: the banner says these times ARE the company-wide default; on a
  // clamped row they are one minute short of it, and 保存 writes the short
  // one. The row has to say so.
  it('a clamped row says so — and only that row', () => {
    open() // ORG_HOURS closes 24:00 on sun alone
    expect(screen.getAllByText('clampedMidnight')).toHaveLength(1)
  })

  it('23:59 typed by hand on an unclamped row carries no note', () => {
    const { container } = open()
    fireEvent.change(timeInputs(container)[1], { target: { value: '23:59' } }) // mon close
    expect(screen.getAllByText('clampedMidnight')).toHaveLength(1)
  })

  it('a store with its OWN saved week is never clamped, so it never carries the note', () => {
    open({ weeklyHours: OWN_WEEK })
    expect(screen.queryByText('clampedMidnight')).not.toBeInTheDocument()
  })

  it('renders the editor only when the disclosure is opened', () => {
    render(
      <StoreHoursBlock
        storeId="store-7"
        storeName="テスト店"
        weeklyHours={null}
        orgHours={ORG_HOURS}
      />,
    )
    expect(screen.queryByText('usingDefault')).not.toBeInTheDocument()
  })
})

describe('a store with its own saved week', () => {
  it('shows its own hours, and does NOT claim the company-wide default', () => {
    const { container } = open({ weeklyHours: OWN_WEEK })
    expect(screen.queryByText('usingDefault')).not.toBeInTheDocument()
    const inputs = timeInputs(container)
    expect(inputs[0].value).toBe('11:00')
    expect(inputs[1].value).toBe('20:00')
  })

  it('a saved 定休日 comes back as 休業, not as a blank window', () => {
    const { container } = open({ weeklyHours: OWN_WEEK })
    const inputs = timeInputs(container)
    // tue is the second row — both its fields are disabled (定休日).
    expect(inputs[2].disabled).toBe(true)
    expect(inputs[3].disabled).toBe(true)
    expect(inputs[0].disabled).toBe(false)
  })
})

describe('the 休業 confirmation', () => {
  it('a 休業 tap asks first and names what stops — the day is not closed yet', () => {
    const { container } = open()
    fireEvent.click(screen.getAllByText('closedToggle')[0])
    expect(screen.getByText('closedConfirm')).toBeInTheDocument()
    expect(timeInputs(container)[0].disabled).toBe(false)
  })

  it('confirming closes the day', () => {
    const { container } = open()
    fireEvent.click(screen.getAllByText('closedToggle')[0])
    fireEvent.click(screen.getByText('closedConfirmYes'))
    expect(screen.queryByText('closedConfirm')).not.toBeInTheDocument()
    expect(timeInputs(container)[0].disabled).toBe(true)
  })

  it('declining leaves the day open', () => {
    const { container } = open()
    fireEvent.click(screen.getAllByText('closedToggle')[0])
    fireEvent.click(screen.getByText('closedConfirmNo'))
    expect(timeInputs(container)[0].disabled).toBe(false)
  })

  it('re-opening a closed day takes nothing away, so it never asks', () => {
    const { container } = open({ weeklyHours: OWN_WEEK })
    // tue is already 定休日 — turning it back ON is the safe direction.
    fireEvent.click(screen.getAllByText('closedToggle')[1])
    expect(screen.queryByText('closedConfirm')).not.toBeInTheDocument()
    expect(timeInputs(container)[2].disabled).toBe(false)
  })
})

describe('saving', () => {
  it('is closed while any row opens after it closes, and opens again when fixed', () => {
    const { container } = open()
    const save = screen.getByText('save')
    expect(save).not.toBeDisabled()
    fireEvent.change(timeInputs(container)[1], { target: { value: '09:00' } }) // mon close < open
    expect(screen.getByText('save')).toBeDisabled()
    expect(screen.getByText('fixBeforeSaving')).toBeInTheDocument()
    fireEvent.change(timeInputs(container)[1], { target: { value: '19:30' } })
    expect(screen.getByText('save')).not.toBeDisabled()
  })

  it('sends ALL SEVEN weekdays, with a closed day as null', async () => {
    const { container } = open()
    fireEvent.change(timeInputs(container)[0], { target: { value: '10:07' } })
    fireEvent.click(screen.getAllByText('closedToggle')[1]) // tue
    fireEvent.click(screen.getByText('closedConfirmYes'))
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(setStoreHours).toHaveBeenCalledTimes(1))
    const [storeId, week] = setStoreHours.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ]
    expect(storeId).toBe('store-7')
    expect(Object.keys(week).sort()).toEqual(['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'])
    expect(week.tue).toBeNull()
    expect(week.mon).toEqual({ open: '10:07', close: '19:30' })
  })

  it('a successful save drops the not-yet-saved marker — the hours are now this store’s own', async () => {
    open()
    expect(screen.getByText('usingDefault')).toBeInTheDocument()
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(screen.queryByText('usingDefault')).not.toBeInTheDocument())
  })

  it('a refused save keeps the marker — nothing is claimed that core did not accept', async () => {
    setStoreHours.mockResolvedValue({ error: 'STORE_HOURS_WEEK_INCOMPLETE' })
    open()
    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(setStoreHours).toHaveBeenCalled())
    expect(screen.getByText('usingDefault')).toBeInTheDocument()
  })
})

// R1-4 — ⚖ reversible by default: the easy direction must never be the
// destructive one. Before this, an owner who opened the block, glanced at the
// pre-filled week and pressed 保存 had pinned the store to those hours with no
// way back through the product.
describe('the way back to the company-wide default', () => {
  it('is not offered while the store is still ON the default — there is nothing to undo', () => {
    open()
    expect(screen.queryByText('resetToDefault')).not.toBeInTheDocument()
  })

  it('appears once the store has a week of its own, and asks before it clears anything', () => {
    open({ weeklyHours: OWN_WEEK })
    fireEvent.click(screen.getByText('resetToDefault'))
    expect(screen.getByText('resetConfirm')).toBeInTheDocument()
    expect(setStoreHours).not.toHaveBeenCalled()
  })

  it('confirming sends an explicit null — the reset, not a seven-day 定休日', async () => {
    open({ weeklyHours: OWN_WEEK })
    fireEvent.click(screen.getByText('resetToDefault'))
    fireEvent.click(screen.getByText('resetConfirmYes'))
    await waitFor(() => expect(setStoreHours).toHaveBeenCalledTimes(1))
    expect(setStoreHours.mock.calls[0]).toEqual(['store-7', null])
  })

  it('after the reset the editor is honest again: the default, marked not yet saved', async () => {
    const { container } = open({ weeklyHours: OWN_WEEK })
    fireEvent.click(screen.getByText('resetToDefault'))
    fireEvent.click(screen.getByText('resetConfirmYes'))
    await waitFor(() => expect(screen.getByText('usingDefault')).toBeInTheDocument())
    expect(timeInputs(container)[0].value).toBe('10:00') // back to the org week
    expect(screen.queryByText('resetToDefault')).not.toBeInTheDocument()
  })

  it('declining changes nothing', () => {
    open({ weeklyHours: OWN_WEEK })
    fireEvent.click(screen.getByText('resetToDefault'))
    fireEvent.click(screen.getByText('closedConfirmNo'))
    expect(screen.queryByText('resetConfirm')).not.toBeInTheDocument()
    expect(setStoreHours).not.toHaveBeenCalled()
  })

  it('a refused reset keeps the store on its own week', async () => {
    setStoreHours.mockResolvedValue({ error: 'nope' })
    const { container } = open({ weeklyHours: OWN_WEEK })
    fireEvent.click(screen.getByText('resetToDefault'))
    fireEvent.click(screen.getByText('resetConfirmYes'))
    await waitFor(() => expect(setStoreHours).toHaveBeenCalled())
    expect(screen.queryByText('usingDefault')).not.toBeInTheDocument()
    expect(timeInputs(container)[0].value).toBe('11:00')
  })
})

// R1-2 — the section's own re-list. Before the fold, refresh() re-listed
// WITHOUT hours, so after any store rename the editor re-offered the
// business-wide default as 「まだ保存されていません」 and one 保存 wrote it
// over the week the owner had just saved.
describe('the section: a refresh never forgets a saved week', () => {
  const row = (id: string, name: string, weeklyHours: unknown) => ({
    id,
    name,
    address: null,
    phone: null,
    isPrimary: id === 'store-7',
    active: true,
    staffCount: 0,
    customerCount: 0,
    businessType: null,
    weeklyHours,
  })

  const renderSection = (initialHours: unknown) =>
    render(
      <StoresSection
        orgSettings={{ operating_hours: ORG_HOURS } as never}
        isOwner
        initialStores={[row('store-7', '代官山', initialHours), row('store-8', '銀座', null)] as never}
        initialActiveStoreId="store-7"
        initialEntitlement={null}
      />,
    )

  /** The 営業時間 disclosure of the Nth store row (index 0 is the section's
   *  own 店舗 heading, which shares the mocked key-as-text). */
  const hoursDisclosure = (n: number) => screen.getAllByText('title')[n + 1]

  it('renames another store, reopens: the SAVED week, no unsaved banner, and 保存 sends it back', async () => {
    listStoresWithHours.mockResolvedValue([
      row('store-7', '代官山', OWN_WEEK),
      row('store-8', '別名', null),
    ])
    const { container } = renderSection(OWN_WEEK)

    // Rename the OTHER store — the path that calls refresh().
    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await waitFor(() => expect(listStoresWithHours).toHaveBeenCalled())

    fireEvent.click(hoursDisclosure(0))
    expect(screen.queryByText('usingDefault')).not.toBeInTheDocument()
    expect(timeInputs(container)[0].value).toBe('11:00')

    fireEvent.click(screen.getByText('save'))
    await waitFor(() => expect(setStoreHours).toHaveBeenCalledTimes(1))
    const [, week] = setStoreHours.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(week.mon).toEqual({ open: '11:00', close: '20:00' })
  })

  it('a re-list that carries NO hours leaves the known week alone (belt to the braces)', async () => {
    // `undefined` = this read never asked. It must not overwrite what the
    // section already knows — the editor would read it as 未設定.
    listStoresWithHours.mockResolvedValue([
      row('store-7', '代官山', undefined),
      row('store-8', '別名', undefined),
    ])
    const { container } = renderSection(OWN_WEEK)

    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await waitFor(() => expect(listStoresWithHours).toHaveBeenCalled())

    fireEvent.click(hoursDisclosure(0))
    expect(screen.queryByText('usingDefault')).not.toBeInTheDocument()
    expect(timeInputs(container)[0].value).toBe('11:00')
  })
})
