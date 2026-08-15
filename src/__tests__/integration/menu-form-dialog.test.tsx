/** @jest-environment jsdom */
// MenuFormDialog — the create/edit editor (menu-catalog plan §3, PR-3).
// EXACT-PAYLOAD assertions (PR-1a's mutation-killer precedent): the actions
// take the FULL menuSchema input, so a dropped or defaulted field would still
// "save" and silently rewrite the menu. Rendered against the REAL ja.json —
// a call-site key typo throws here.
//
// The three 8/15 additions live in this file too: pristine-save disable
// (the source-level suppression of empty-detail menu_update audit rows),
// double-submit disable, and the ②b store-widening confirm.
import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

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
const toastError = jest.fn()
const toastSuccess = jest.fn()
jest.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }))

const createMenu = jest.fn(async () => ({ id: 'created' }) as { id: string } | { error: string })
const updateMenu = jest.fn(async () => ({ ok: true }) as { ok: true } | { error: string })
jest.mock('@/actions/menus', () => ({
  createMenu: (...args: unknown[]) => createMenu(...(args as [])),
  updateMenu: (...args: unknown[]) => updateMenu(...(args as [])),
}))

import { MenuFormDialog } from '@/components/settings/redesign/sections/menus/MenuFormDialog'
import type { Menu } from '@synqed-kk/client'
import type { StoreRow } from '@/actions/stores'

const BUSINESS = '6f1d0b26-3f5e-4a1e-9c62-8b0a4f21d7c3'
const HONTEN = 'b2f70c19-4d6a-4f38-8e51-0c9b62a4f5d1'
const EKIMAE = 'c4a9f0d7-2b83-4e51-9f6a-1d7c53e08b42'

const storeRow = (id: string, name: string): StoreRow => ({
  id,
  name,
  address: null,
  phone: null,
  isPrimary: id === HONTEN,
  active: true,
  staffCount: 3,
  customerCount: 120,
  businessType: null,
})
const STORES = [storeRow(HONTEN, '本店（メイン）'), storeRow(EKIMAE, '駅前店')]

function menu(over: Partial<Menu> & Pick<Menu, 'id' | 'name'>): Menu {
  return {
    business_id: BUSINESS,
    store_id: null,
    description: null,
    category: null,
    category_display_order: 0,
    display_order: 0,
    duration_minutes: 60,
    price_list_amount: 5500,
    price_min_amount: null,
    currency: 'JPY',
    tax_included: true,
    nomination_allowed: true,
    online_visible: true,
    active: true,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

// Realistic salon catalog. トリートメント's highest 表示順 is 50, so a new
// menu in that category defaults to 60 — a number no other field could
// coincidentally produce.
const CUT = menu({
  id: '0a7d3c18-5e94-4b62-8f31-2c6d90ab74e5',
  name: 'カット',
  category: 'カット',
  display_order: 10,
})
const RETOUCH = menu({
  id: '2c9f5e3a-70b6-4d84-a153-4e8f12cd96a7',
  name: 'リタッチカラー',
  category: 'カラー',
  duration_minutes: 90,
  price_list_amount: 8800,
  price_min_amount: 6600,
  display_order: 30,
})
const TREATMENT = menu({
  id: '3da06f4b-81c7-4e95-b264-5f9023de07b8',
  name: 'トリートメント',
  category: 'トリートメント',
  duration_minutes: 45,
  price_list_amount: 5500,
  price_min_amount: 3300,
  display_order: 40,
})
// The store-scoped row — the only fixture that can trigger the ②b confirm.
const SPA = menu({
  id: '4eb17a5c-92d8-4fa6-8375-609134ef18c9',
  name: 'ヘッドスパ',
  category: 'トリートメント',
  duration_minutes: 45,
  price_list_amount: 4400,
  store_id: EKIMAE,
  display_order: 50,
})
const CATALOG = [CUT, RETOUCH, TREATMENT, SPA]

type Mode = null | { kind: 'create' } | { kind: 'edit'; menu: Menu }

// ONE stable onClose across rerenders — the dismissal-race test counts it.
const onClose = jest.fn()

function open(mode: Exclude<Mode, null>, stores = STORES) {
  const view = render(
    <MenuFormDialog mode={mode} catalog={CATALOG} stores={stores} onClose={onClose} />,
  )
  return (next: Mode) =>
    view.rerender(
      <MenuFormDialog mode={next} catalog={CATALOG} stores={stores} onClose={onClose} />,
    )
}

/** A write the test resolves by hand — the only way to observe in-flight state. */
function hangingUpdate() {
  let finish: (r: { ok: true }) => void = () => {}
  updateMenu.mockReturnValueOnce(new Promise((res) => { finish = res }))
  return async () => act(async () => { finish({ ok: true }) })
}

const field = (label: RegExp) => screen.getByLabelText(label) as HTMLInputElement
const type = (label: RegExp, value: string) =>
  fireEvent.change(field(label), { target: { value } })
const saveButton = () => screen.getByRole('button', { name: '保存' }) as HTMLButtonElement
const openDetails = () => fireEvent.click(screen.getByText('詳細（店舗・オンライン表示・表示順）'))

beforeEach(() => jest.clearAllMocks())

describe('MenuFormDialog — create', () => {
  it('保存 stays inert until name, duration and price are all filled', () => {
    open({ kind: 'create' })
    expect(saveButton().disabled).toBe(true)

    type(/メニュー名/, 'ヘッドスパ')
    expect(saveButton().disabled).toBe(true)
    type(/所要時間/, '45')
    expect(saveButton().disabled).toBe(true)
    type(/通常価格/, '4400')
    expect(saveButton().disabled).toBe(false)
  })

  // Each required field gated INDEPENDENTLY — the progressive test above would
  // still pass if only two of the three checks survived.
  it('a blank メニュー名 alone keeps 保存 inert', () => {
    open({ kind: 'create' })
    type(/所要時間/, '45')
    type(/通常価格/, '4400')
    expect(saveButton().disabled).toBe(true)
  })

  it('a blank 所要時間 alone keeps 保存 inert', () => {
    open({ kind: 'create' })
    type(/メニュー名/, 'ヘッドスパ')
    type(/通常価格/, '4400')
    expect(saveButton().disabled).toBe(true)
  })

  it('sends the EXACT payload, 表示順 defaulting to the chosen category max + 10', async () => {
    open({ kind: 'create' })
    type(/メニュー名/, 'ヘッドスパ')
    type(/カテゴリ/, 'トリートメント')
    type(/所要時間/, '45')
    type(/通常価格/, '4400')
    fireEvent.click(saveButton())

    await waitFor(() => expect(createMenu).toHaveBeenCalledTimes(1))
    expect(createMenu).toHaveBeenCalledWith({
      name: 'ヘッドスパ',
      category: 'トリートメント',
      duration_minutes: 45,
      price_list_amount: 4400,
      price_min_amount: null,
      store_id: null,
      online_visible: true,
      display_order: 60,
    })
    expect(updateMenu).not.toHaveBeenCalled()
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('保存しました'))
  })

  it('a suggestion chip fills the free-text category and re-aims the 表示順 default', async () => {
    open({ kind: 'create' })
    type(/メニュー名/, 'カット（学生）')
    type(/所要時間/, '60')
    type(/通常価格/, '4400')
    fireEvent.click(screen.getByRole('button', { name: 'カット' }))
    expect(field(/カテゴリ/).value).toBe('カット')
    fireEvent.click(saveButton())

    await waitFor(() => expect(createMenu).toHaveBeenCalledTimes(1))
    // カット's only row sits at 10 → the next slot is 20, not トリートメント's 60.
    expect(createMenu).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'カット', display_order: 20 }),
    )
  })

  it('never asks the ②b widening question — a new menu has no store to widen FROM', async () => {
    open({ kind: 'create' })
    type(/メニュー名/, '着付け')
    type(/所要時間/, '60')
    type(/通常価格/, '6600')
    fireEvent.click(saveButton())

    await waitFor(() => expect(createMenu).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/全店舗に変更しますか/)).toBeNull()
  })
})

describe('MenuFormDialog — edit', () => {
  it('opens PRISTINE: 保存 is inert until a field actually differs', () => {
    open({ kind: 'edit', menu: RETOUCH })
    expect(saveButton().disabled).toBe(true)

    type(/通常価格/, '9900')
    expect(saveButton().disabled).toBe(false)

    // Back to the stored value → inert again: no empty-detail menu_update row.
    type(/通常価格/, '8800')
    expect(saveButton().disabled).toBe(true)
  })

  it('sends the row id and the FULL input, not a partial', async () => {
    open({ kind: 'edit', menu: RETOUCH })
    type(/通常価格/, '9900')
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    expect(updateMenu).toHaveBeenCalledWith(RETOUCH.id, {
      name: 'リタッチカラー',
      category: 'カラー',
      duration_minutes: 90,
      price_list_amount: 9900,
      price_min_amount: 6600,
      store_id: null,
      online_visible: true,
      display_order: 30,
    })
    expect(createMenu).not.toHaveBeenCalled()
  })

  it('a floor above the list price is blocked CLIENT-side — no write leaves the dialog', () => {
    open({ kind: 'edit', menu: TREATMENT })
    type(/最低価格/, '9900')
    fireEvent.click(saveButton())

    expect(toastError).toHaveBeenCalledWith('Minimum price cannot be above the list price')
    expect(updateMenu).not.toHaveBeenCalled()
  })

  it('a failed write keeps the dialog open with every value intact', async () => {
    updateMenu.mockResolvedValueOnce({ error: 'Could not update menu: offline' })
    open({ kind: 'edit', menu: RETOUCH })
    type(/メニュー名/, 'リタッチカラー（ロング）')
    fireEvent.click(saveButton())

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not update menu: offline'))
    expect(field(/メニュー名/).value).toBe('リタッチカラー（ロング）')
    expect(saveButton().disabled).toBe(false)
    expect(toastSuccess).not.toHaveBeenCalled()
  })

  // Cancel means DISCARD. The body stays mounted after close (the last-mode
  // mirror keeps the closing animation honest), so without an open counter in
  // its key the abandoned draft comes back on reopen — 保存 enabled, pristine
  // rule dead.
  it('a cancelled edit is discarded — reopening the same menu shows the STORED row', () => {
    const setMode = open({ kind: 'edit', menu: RETOUCH })
    type(/メニュー名/, 'リタッチカラー（下書き）')
    expect(saveButton().disabled).toBe(false)

    setMode(null)
    setMode({ kind: 'edit', menu: RETOUCH })

    expect(field(/メニュー名/).value).toBe('リタッチカラー')
    expect(saveButton().disabled).toBe(true)
  })

  it('double-submit: 保存 goes inert while the write is in flight', async () => {
    const settle = hangingUpdate()
    open({ kind: 'edit', menu: RETOUCH })
    type(/所要時間/, '100')
    fireEvent.click(saveButton())

    await waitFor(() => expect(saveButton().disabled).toBe(true))
    fireEvent.click(saveButton())
    expect(updateMenu).toHaveBeenCalledTimes(1)

    await settle()
    expect(toastSuccess).toHaveBeenCalledWith('保存しました')
  })

  it('キャンセル is inert too while the write is in flight — no escape through the back door', async () => {
    const settle = hangingUpdate()
    open({ kind: 'edit', menu: RETOUCH })
    type(/所要時間/, '100')
    fireEvent.click(saveButton())

    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect((screen.getByRole('button', { name: 'キャンセル' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    await settle()
  })

  it('オンライン表示 rides the payload — the flag is wired, not hardcoded true', async () => {
    open({ kind: 'edit', menu: RETOUCH })
    openDetails()
    fireEvent.click(screen.getByRole('switch', { name: 'オンライン表示' }))
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    expect(updateMenu).toHaveBeenCalledWith(
      RETOUCH.id,
      expect.objectContaining({ online_visible: false }),
    )
  })

  // ESC, an outside click and the X are NOT gated while a write is in flight,
  // so a dismissed body can resolve after its instance is gone. The write
  // itself already landed server-side; what must never happen is its stale
  // closure toasting 保存しました and force-closing whatever dialog replaced it.
  // Same rule, the OTHER stale shape: dismissed and left closed, so the body
  // is still mounted behind the exit animation (the last-mode mirror) and only
  // its `active` flag went false. No open dialog → no dialog UI effects.
  it('a dismissed save that is never reopened stays silent on success', async () => {
    const settle = hangingUpdate()
    const setMode = open({ kind: 'edit', menu: RETOUCH })
    type(/通常価格/, '9900')
    fireEvent.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))

    setMode(null)
    await settle()

    expect(updateMenu).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('…and stays silent on failure — a closed dialog has no values left to preserve', async () => {
    let finish: (r: { error: string }) => void = () => {}
    updateMenu.mockReturnValueOnce(new Promise((res) => { finish = res }))
    const setMode = open({ kind: 'edit', menu: RETOUCH })
    type(/通常価格/, '9900')
    fireEvent.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))

    setMode(null)
    await act(async () => { finish({ error: 'Could not update menu: offline' }) })

    expect(updateMenu).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  // The OTHER guard half, proven on its own: swapping straight from one row to
  // another never passes null, so `active` stays true throughout and only the
  // key's menu id unmounts the old body. If alive stopped being consulted, the
  // dead body's closure would toast and close over the row that replaced it.
  it('a pending save survives a row→row swap without touching the new row', async () => {
    const settle = hangingUpdate()
    const setMode = open({ kind: 'edit', menu: RETOUCH })
    type(/通常価格/, '9900')
    fireEvent.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))

    // One rerender, straight to another menu — never null in between.
    setMode({ kind: 'edit', menu: TREATMENT })
    await settle()

    expect(updateMenu).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(field(/メニュー名/).value).toBe('トリートメント')
  })

  // StrictMode double-invokes every mount in dev. A cleanup-only alive effect
  // would run its cleanup on the throwaway mount and never re-arm, freezing
  // EVERY dev-mode save after its await. Production never double-invokes, so
  // this is the only gate that can see it.
  it('saves still complete under StrictMode double-mounting', async () => {
    render(
      <StrictMode>
        <MenuFormDialog
          mode={{ kind: 'edit', menu: RETOUCH }}
          catalog={CATALOG}
          stores={STORES}
          onClose={onClose}
        />
      </StrictMode>,
    )
    type(/通常価格/, '9900')
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('保存しました'))
    expect(onClose).toHaveBeenCalled()
  })

  it('a dismissed save cannot toast or close the dialog that replaced it', async () => {
    const settle = hangingUpdate()
    const setMode = open({ kind: 'edit', menu: RETOUCH })
    type(/通常価格/, '9900')
    fireEvent.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))

    setMode(null)
    setMode({ kind: 'edit', menu: TREATMENT })
    await settle()

    expect(updateMenu).toHaveBeenCalledTimes(1)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(field(/メニュー名/).value).toBe('トリートメント')
  })
})

describe('MenuFormDialog — ②b store-widening confirm', () => {
  const widen = () => {
    open({ kind: 'edit', menu: SPA })
    openDetails()
    fireEvent.click(screen.getByRole('button', { name: '全店舗' }))
    fireEvent.click(saveButton())
  }

  it('fires on 駅前店 → 全店舗 with the mock ②b copy, and holds the write back', () => {
    widen()
    expect(screen.getByText('「ヘッドスパ」を全店舗に変更しますか？')).toBeTruthy()
    expect(
      screen.getByText(
        '現在は駅前店のみのメニューです。保存すると、すべての店舗の予約で選べるようになります。予約履歴・カルテは変わりません。',
      ),
    ).toBeTruthy()
    expect(updateMenu).not.toHaveBeenCalled()
  })

  it('accepting saves with store_id null', async () => {
    widen()
    fireEvent.click(screen.getByRole('button', { name: '全店舗に変更する' }))

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    expect(updateMenu).toHaveBeenCalledWith(SPA.id, expect.objectContaining({ store_id: null }))
  })

  it('its confirm button goes inert while the write it started is in flight', async () => {
    const settle = hangingUpdate()
    const confirmButton = () =>
      screen.getByRole('button', { name: '全店舗に変更する' }) as HTMLButtonElement
    widen()
    fireEvent.click(confirmButton())

    // The confirm STAYS UP for the write, so the pending state sits on the
    // button that was pressed — and a second press can't double-write.
    await waitFor(() => expect(confirmButton().disabled).toBe(true))
    fireEvent.click(confirmButton())
    expect(updateMenu).toHaveBeenCalledTimes(1)

    await settle()
  })

  it('cancelling returns to the open dialog with values intact and nothing written', async () => {
    widen()
    fireEvent.click(screen.getAllByRole('button', { name: 'キャンセル' })[0])

    await waitFor(() => expect(screen.queryByText('「ヘッドスパ」を全店舗に変更しますか？')).toBeNull())
    expect(updateMenu).not.toHaveBeenCalled()
    expect(field(/メニュー名/).value).toBe('ヘッドスパ')
    expect(screen.getByRole('button', { name: '全店舗' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('店舗 → 店舗 is not a widening — it saves straight through', async () => {
    open({ kind: 'edit', menu: SPA })
    openDetails()
    fireEvent.click(screen.getByRole('button', { name: '本店（メイン）' }))
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    expect(updateMenu).toHaveBeenCalledWith(SPA.id, expect.objectContaining({ store_id: HONTEN }))
    expect(screen.queryByText(/全店舗に変更しますか/)).toBeNull()
  })

  it('全店舗 → 店舗 (narrowing) is not a widening either', async () => {
    open({ kind: 'edit', menu: TREATMENT })
    openDetails()
    fireEvent.click(screen.getByRole('button', { name: '駅前店' }))
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    expect(updateMenu).toHaveBeenCalledWith(
      TREATMENT.id,
      expect.objectContaining({ store_id: EKIMAE }),
    )
    expect(screen.queryByText(/全店舗に変更しますか/)).toBeNull()
  })
})

describe('MenuFormDialog — degraded store read (menus.manage without stores.viewAll)', () => {
  it('an empty stores prop hides 店舗 entirely and saves the stored scope back unchanged', async () => {
    open({ kind: 'edit', menu: SPA }, [])
    openDetails()

    // No store names to read → no blind scope editing, and no 「現在は店舗限定
    // のみのメニューです」 confirm sentence.
    expect(screen.queryByRole('group', { name: '店舗' })).toBeNull()
    expect(screen.queryByRole('button', { name: '全店舗' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'オンライン表示' })).toBeTruthy()

    type(/通常価格/, '4950')
    fireEvent.click(saveButton())

    await waitFor(() => expect(updateMenu).toHaveBeenCalledTimes(1))
    expect(updateMenu).toHaveBeenCalledWith(
      SPA.id,
      expect.objectContaining({ store_id: EKIMAE, price_list_amount: 4950 }),
    )
    expect(screen.queryByText(/全店舗に変更しますか/)).toBeNull()
  })
})
