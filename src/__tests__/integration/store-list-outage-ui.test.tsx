/**
 * @jest-environment jsdom
 *
 * The 設定 店舗 section and the header switcher SAY the store list could not
 * be read (Round 3 leg 8a, 2026-09-26, D-S31-4).
 *
 * Before: a store-list outage reached StoresSection as [] — it seeded ONE fake
 * 本店 card from the salon name (0 staff · 0 customers · a live 編集 on a store
 * id that does not exist) or, with no org settings either, 「店舗が登録されて
 * いません」; refresh() crashed on a null read after a save or a failed switch,
 * with no message; and the header StoreSwitcher hid, byte-identical to a
 * one-store salon.
 *
 * Pins (rows k–p of the packet): k storesUnavailable → the listUnavailable line,
 * no seeded row, no 「0店舗」 caption · l rows on screen, then refresh() reads
 * null twice → the rows stay, the line shows once · m a later good read clears
 * the line · n StoreSwitcher `unavailable` → a non-interactive pill · o
 * MobileHeader threads the flag · p the flag absent + one store → null, as today
 * · q a PARTIAL outage (the with-hours read null, the plain read rows): no
 * line, the rows repaint, and the hours already on screen stay — a plain row
 * carries no hours, and reading that as 未設定 would let one 保存 write the
 * business-wide week over the store's own (Greptile G1).
 *
 * RED on main: k (the fake row / the empty-state line), l (the null read
 * throws inside refresh), m (no line ever), n, o (the switcher renders null).
 * Green on main: p. q is RED with refresh()'s mergeKnownHours dropped.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

jest.mock('next-intl', () => ({
  // Values ride into the rendered string so a dropped interpolation is visible.
  useTranslations: () => (k: string, v?: Record<string, unknown>) => (v ? `${k} ${JSON.stringify(v)}` : k),
  useLocale: () => 'ja',
}))
jest.mock('next/navigation', () => ({
  usePathname: () => '/ja',
  useRouter: () => ({ back: jest.fn(), refresh: jest.fn() }),
}))
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }))
// Pass-through wrappers so each row arms the door's answer (the web door's
// union: rows | [] | null).
const listStoresWithHours = jest.fn(async (): Promise<unknown> => [])
const listStores = jest.fn(async (): Promise<unknown> => [])
const updateStore = jest.fn(async () => ({ ok: true }) as { ok: true } | { error: string })
const setActiveStore = jest.fn(async () => ({ ok: true }) as { ok: true } | { error: string })
jest.mock('@/actions/stores', () => ({
  listStoresWithHours: () => listStoresWithHours(),
  listStores: () => listStores(),
  updateStore: (...a: unknown[]) => updateStore(...(a as [])),
  setActiveStore: (...a: unknown[]) => setActiveStore(...(a as [])),
  createStore: jest.fn(async () => ({ id: 'store-new' })),
  getActiveStoreId: jest.fn(async () => null),
  clearActiveStore: jest.fn(async () => ({ ok: true })),
}))
jest.mock('@/actions/entitlements', () => ({ getEntitlement: jest.fn(async () => null) }))
jest.mock('@/components/settings/redesign/sections/stores/AddStoreSubscriptionDialog', () => ({
  AddStoreSubscriptionDialog: () => null,
}))
jest.mock('@/components/settings/redesign/sections/stores/StoreFormDialog', () => ({
  // handleFormSave is only reachable through onSave — the save that calls refresh().
  StoreFormDialog: ({ mode, onSave }: { mode: unknown; onSave: (v: unknown) => void }) =>
    mode ? (
      <button type="button" onClick={() => onSave({ name: '改名', address: '', phone: '', businessType: '' })}>
        submit-rename
      </button>
    ) : null,
}))
jest.mock('@/components/settings/redesign/sections/stores/PlanComparisonDialog', () => ({
  PlanComparisonDialog: () => null,
}))
// Echoes the two props the 営業時間 editor seeds from, so a row can read what
// the hours block of each store receives after a refresh(). `undefined` is
// spelled out: it means "this read never asked", which the editor would take
// as 全店共通の初期値を使用中.
jest.mock('@/components/settings/redesign/sections/stores/StoreHoursBlock', () => ({
  StoreHoursBlock: ({
    storeId,
    weeklyHours,
    weeklyHoursUnreadable,
  }: {
    storeId: string
    weeklyHours?: unknown
    weeklyHoursUnreadable?: boolean
  }) => (
    <div
      data-testid={`hours-${storeId}`}
      data-week={weeklyHours === undefined ? 'undefined' : JSON.stringify(weeklyHours)}
      data-unreadable={String(weeklyHoursUnreadable)}
    />
  ),
}))
// MobileHeader's own dependencies (mobile-header.test.tsx does the same).
jest.mock('@/lib/notifications/hooks', () => ({
  useUnreadCount: () => 0,
  formatUnreadBadge: (n: number) => String(n),
  useNotificationMutations: () => ({
    markRead: jest.fn(),
    markAllRead: jest.fn(),
    clearAll: jest.fn(),
    setLastSeen: jest.fn(),
  }),
}))
jest.mock('@/hooks/use-global-recorder', () => ({ useGlobalRecorder: () => ({ state: 'idle' }) }))
jest.mock('@/components/notifications/NotificationsPanel', () => ({ NotificationsPanel: () => null }))

import type { StoreRow } from '@/actions/stores'
import type { OrgSettings } from '@/actions/org-settings'
import { StoresSection } from '@/components/settings/redesign/sections/StoresSection'
import { StoreSwitcher } from '@/components/layout/StoreSwitcher'
import { MobileHeader } from '@/components/layout/MobileHeader'

const SALON = 'ラ・エストロ本店名'
const orgSettings = { salon_name: SALON, business_type: 'hair_salon' } as unknown as OrgSettings

const row = (id: string, name: string, isPrimary = false): StoreRow => ({
  id,
  name,
  address: null,
  phone: null,
  isPrimary,
  active: true,
  staffCount: 2,
  customerCount: 9,
  businessType: null,
})
const A = row('store-a', '代官山', true)
const B = row('store-b', '銀座')
/** Store A's own saved week, as the with-hours read (the 設定 page's) carries it. */
const WEEK_A: NonNullable<StoreRow['weeklyHours']> = {
  mon: { open: '11:00', close: '20:00' },
  tue: null,
  wed: { open: '11:00', close: '20:00' },
  thu: { open: '11:00', close: '20:00' },
  fri: { open: '11:00', close: '20:00' },
  sat: { open: '10:00', close: '19:00' },
  sun: { open: '10:00', close: '18:00' },
}
/** What store `id`'s hours block received: [weeklyHours, weeklyHoursUnreadable]. */
const hoursProps = (id: string) => {
  const el = screen.getByTestId(`hours-${id}`)
  return [el.getAttribute('data-week'), el.getAttribute('data-unreadable')]
}

beforeEach(() => {
  jest.clearAllMocks()
  listStoresWithHours.mockResolvedValue([])
  listStores.mockResolvedValue([])
  updateStore.mockResolvedValue({ ok: true })
  setActiveStore.mockResolvedValue({ ok: true })
})

/** Waits for every in-flight refresh() read to be called and settled. */
const settle = async (calls: number) => {
  await waitFor(() => expect(listStoresWithHours).toHaveBeenCalledTimes(calls))
  await waitFor(() => {})
}

describe('StoresSection — the store list could not be read', () => {
  it('(k) storesUnavailable: the listUnavailable line, NO seeded row named after the salon, no store-count caption', async () => {
    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue(null)
    render(
      <StoresSection orgSettings={orgSettings} isOwner initialStores={[]} initialActiveStoreId={null} storesUnavailable />,
    )
    // First paint, before the mount refresh() settles: no made-up 本店 card.
    expect(screen.queryByText(SALON)).toBeNull()
    expect(screen.getAllByText('listUnavailable')).toHaveLength(1)
    expect(screen.queryByText(/^storesCount/)).toBeNull()
    // The mount refresh() is the one retry — it also reads null (the with-hours
    // read, then its plain fallback, once each), and the section stays honest.
    await settle(1)
    await waitFor(() => expect(listStores).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText('listUnavailable')).toHaveLength(1)
    expect(screen.queryByText(SALON)).toBeNull()
    expect(screen.queryByText('unnamedStore')).toBeNull()
    expect(screen.queryByText('emptyState')).toBeNull()
    expect(screen.queryByText(/^storesCount/)).toBeNull()
    // No row → no 編集 / 切り替え on a store that does not exist.
    expect(screen.queryByLabelText('edit')).toBeNull()
    expect(screen.queryByText('switchTo')).toBeNull()
    expect(screen.queryByText('viewing')).toBeNull()
  })

  it('(k) the same with NO org settings (a full outage): the line, never 「no stores registered」', async () => {
    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue(null)
    render(<StoresSection orgSettings={null} initialStores={[]} initialActiveStoreId={null} storesUnavailable />)
    expect(screen.queryByText('emptyState')).toBeNull()
    expect(screen.getAllByText('listUnavailable')).toHaveLength(1)
    await settle(1)
    await waitFor(() => expect(listStores).toHaveBeenCalledTimes(1))
    expect(screen.getAllByText('listUnavailable')).toHaveLength(1)
    expect(screen.queryByText('emptyState')).toBeNull()
    expect(screen.queryByText(/^storesCount/)).toBeNull()
  })

  it('(l) rows on screen, then a save’s refresh() reads null twice → the rows stay and the line shows ONCE', async () => {
    render(<StoresSection orgSettings={orgSettings} isOwner initialStores={[A, B]} initialActiveStoreId="store-a" />)
    expect(listStoresWithHours).not.toHaveBeenCalled() // server-seeded: no mount re-list
    expect(screen.queryByText('listUnavailable')).toBeNull()

    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue(null)
    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await settle(1)
    await waitFor(() => expect(screen.getAllByText('listUnavailable')).toHaveLength(1))
    // The null with-hours read fell back to the plain read once, exactly.
    expect(listStores).toHaveBeenCalledTimes(1)
    expect(screen.getByText('代官山')).toBeInTheDocument()
    expect(screen.getByText('銀座')).toBeInTheDocument()
    expect(screen.queryByText(SALON)).toBeNull()
    // The rows on screen are still counted — only a 0 would be a lie.
    expect(screen.getByText('storesCount {"n":2}')).toBeInTheDocument()
  })

  it('(l) the same after a failed switch (the other refresh() caller)', async () => {
    render(<StoresSection orgSettings={orgSettings} initialStores={[A, B]} initialActiveStoreId="store-a" />)
    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue(null)
    setActiveStore.mockResolvedValue({ error: 'Store not found.' })
    fireEvent.click(screen.getByText('switchTo'))
    await settle(1)
    await waitFor(() => expect(screen.getAllByText('listUnavailable')).toHaveLength(1))
    expect(screen.getByText('代官山')).toBeInTheDocument()
    expect(screen.getByText('銀座')).toBeInTheDocument()
  })

  it('(m) the server said unavailable, the mount refresh() reads rows → the line is gone and the rows paint', async () => {
    listStoresWithHours.mockResolvedValue([A])
    render(
      <StoresSection orgSettings={orgSettings} isOwner initialStores={[]} initialActiveStoreId={null} storesUnavailable />,
    )
    await waitFor(() => expect(screen.getByText('代官山')).toBeInTheDocument())
    expect(screen.queryByText('listUnavailable')).toBeNull()
    expect(screen.getByText('storesCount {"n":1}')).toBeInTheDocument()
    expect(listStores).not.toHaveBeenCalled()
  })

  it('(m) a failed refresh() then a good one → the line clears and the new rows paint', async () => {
    render(<StoresSection orgSettings={orgSettings} isOwner initialStores={[A, B]} initialActiveStoreId="store-a" />)
    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue(null)
    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await waitFor(() => expect(screen.getAllByText('listUnavailable')).toHaveLength(1))

    listStoresWithHours.mockResolvedValue([A, row('store-b', '銀座 改名')])
    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await waitFor(() => expect(screen.getByText('銀座 改名')).toBeInTheDocument())
    expect(screen.queryByText('listUnavailable')).toBeNull()
  })

  it('(q) a partial outage — the hours read answers null, the plain read answers rows: no line, the rows repaint, the hours on screen stay', async () => {
    render(
      <StoresSection
        orgSettings={orgSettings}
        isOwner
        initialStores={[
          { ...A, weeklyHours: WEEK_A, weeklyHoursUnreadable: false },
          { ...B, weeklyHours: null, weeklyHoursUnreadable: false },
        ]}
        initialActiveStoreId="store-a"
        initialEntitlement={null}
      />,
    )
    expect(hoursProps('store-a')).toEqual([JSON.stringify(WEEK_A), 'false'])

    // core's storePolicies read is down, stores itself is up: the with-hours
    // door answers null, the plain door answers rows that carry NO hours.
    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue([A, row('store-b', '銀座 改名')])
    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await waitFor(() => expect(screen.getByText('銀座 改名')).toBeInTheDocument())
    expect(listStoresWithHours).toHaveBeenCalledTimes(1)
    expect(listStores).toHaveBeenCalledTimes(1)

    // The plain read DID answer: no outage line, the rows are its rows.
    expect(screen.queryByText('listUnavailable')).toBeNull()
    expect(screen.getByText('代官山')).toBeInTheDocument()
    expect(screen.getByText('storesCount {"n":2}')).toBeInTheDocument()
    // …and the hours already shown are kept, never taken as 未設定: A keeps
    // its saved week, B stays a KNOWN "no own week" (null, not "never asked").
    expect(hoursProps('store-a')).toEqual([JSON.stringify(WEEK_A), 'false'])
    expect(hoursProps('store-b')).toEqual(['null', 'false'])
  })

  it('(q) the same keeps an UNREADABLE week unreadable — a plain re-list never re-opens writes over it', async () => {
    render(
      <StoresSection
        orgSettings={orgSettings}
        isOwner
        initialStores={[
          { ...A, weeklyHours: null, weeklyHoursUnreadable: true },
          { ...B, weeklyHours: null, weeklyHoursUnreadable: false },
        ]}
        initialActiveStoreId="store-a"
        initialEntitlement={null}
      />,
    )
    expect(hoursProps('store-a')).toEqual(['null', 'true'])

    listStoresWithHours.mockResolvedValue(null)
    listStores.mockResolvedValue([A, row('store-b', '銀座 改名')])
    fireEvent.click(screen.getAllByLabelText('edit')[1])
    fireEvent.click(screen.getByText('submit-rename'))
    await waitFor(() => expect(screen.getByText('銀座 改名')).toBeInTheDocument())
    expect(listStores).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('listUnavailable')).toBeNull()
    expect(hoursProps('store-a')).toEqual(['null', 'true'])
  })

  it('a TRUE empty from a live read (no flag) still says emptyState, not the outage line', async () => {
    render(<StoresSection orgSettings={null} initialStores={[]} initialActiveStoreId={null} />)
    await settle(1)
    expect(screen.getByText('emptyState')).toBeInTheDocument()
    expect(screen.queryByText('listUnavailable')).toBeNull()
  })
})

describe('StoreSwitcher / MobileHeader — the store list could not be read', () => {
  it('(n) unavailable → the pill says switcherUnavailable, no listbox, nothing to tap', () => {
    const { container } = render(<StoreSwitcher stores={[]} activeStoreId={null} unavailable />)
    expect(screen.getByText('switcherUnavailable')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('switcherUnavailable')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelectorAll('button, a, input, select, [tabindex], [role="button"]')).toHaveLength(0)
    fireEvent.click(screen.getByText('switcherUnavailable'))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(setActiveStore).not.toHaveBeenCalled()
  })

  it('(o) MobileHeader threads storesUnavailable to the switcher', () => {
    render(<MobileHeader stores={[]} activeStoreId={null} storesUnavailable />)
    expect(screen.getByRole('status')).toHaveTextContent('switcherUnavailable')
  })

  it('(p) the flag absent + ONE store → the switcher renders nothing, exactly as today', () => {
    const { container } = render(<StoreSwitcher stores={[A]} activeStoreId="store-a" />)
    expect(container).toBeEmptyDOMElement()
    render(<MobileHeader stores={[A]} activeStoreId="store-a" />)
    expect(screen.queryByText('switcherUnavailable')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
  })

  it('(p) the flag absent + two stores → the interactive pill, as today', () => {
    render(<StoreSwitcher stores={[A, B]} activeStoreId="store-a" />)
    expect(screen.queryByText('switcherUnavailable')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /代官山/ }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })
})
