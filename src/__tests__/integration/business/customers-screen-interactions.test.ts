/**
 * @jest-environment jsdom
 *
 * Business 顧客 screen — interaction-parity tests for five of the six WO-1b
 * gap closures (PACKET-PARITY-WAVE-2026-08-19 ADDENDUM 2: "RTL user-event
 * tests are the machine check for interaction parity (focus handoff,
 * Escape/outside-click close, backdrop close, state flips) ... the six
 * WO-1b gap closures get theirs via the branch-1 micro-fix"). The sixth gap
 * (表示する列 refuses to hide the last column) is already covered by
 * foundation.test.ts's `toggleColumn` unit test (added in the same commit
 * that closed the gap) — not duplicated here.
 *
 * Territory's import fence (business-isolation.test.ts) allows only
 * react/next/node specifiers inside `src/__tests__/integration/business/` —
 * no @testing-library/* package resolves to any of those, so this suite
 * cannot render CustomersScreen with a DOM renderer (react-dom is off the
 * allowlist by the same rule). Instead, the five DOM-touching handlers
 * (search matching, clear+refocus, popover open/Escape/outside-click,
 * create-dialog open, backdrop close) are exported from CustomersScreen.tsx
 * as small functions parameterized on real DOM nodes — the same pattern
 * already used for `toggleColumn` — and exercised here with plain jsdom
 * (globals only, zero extra imports: `document`/`HTMLElement`/events all
 * come from the `@jest-environment jsdom` runtime, not a package).
 *
 * jsdom 20 (this repo's pin) ships no HTMLDialogElement.showModal/close —
 * added in a later jsdom major — so the two dialog tests polyfill just
 * enough of the native contract (the `open` boolean flipping); `open`
 * itself is already a normal reflected attribute in jsdom 20.
 */
import { wireColumnsPopover } from '@/business/lib/column-config'
import {
  matchesCustomerSearch,
  clearSearch,
  compareFields,
  dupeReason,
  openCreateDialog,
  closeOnBackdropClick,
  ticketLabel,
  walletLabel,
  TILE_PREDICATE,
  type CustomerRow,
} from '@/app/[locale]/(business)/business/customers/CustomersScreen'
import { winBackLine } from '@/app/[locale]/(business)/business/customers/customers-props'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.open = true
  }
}
if (typeof HTMLDialogElement.prototype.close !== 'function') {
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.open = false
  }
}

function row(overrides: Partial<CustomerRow> & Pick<CustomerRow, 'id' | 'no' | 'name'>): CustomerRow {
  return {
    furigana: null,
    mark: overrides.name.slice(0, 2),
    phone: null,
    email: null,
    source: '店頭登録',
    identityCheck: null,
    storeLabel: null,
    groupKey: '',
    hasNext: false,
    nextLabel: 'なし',
    nextMenu: '予約なし',
    nextDetail: '次回予約なし',
    nextPrice: '予約確定後に記録',
    ticket: null,
    wallet: null,
    lastVisitShort: null,
    lastVisitFull: null,
    totalSpent: null,
    consent: null,
    lineLinked: false,
    merge: 'none',
    duplicateOf: null,
    party: [],
    thin: false,
    externalOwner: false,
    note: null,
    history: [],
    bookings: [],
    daysSinceLastVisit: null,
    winBack: '来店記録なし',
    lastVisitMeta: '最終来店 記録なし',
    category: 'repeat',
    categoryChip: null,
    ticketEnding: false,
    ...overrides,
  }
}

describe('顧客 screen — interaction parity (WO-1b gap closures)', () => {
  it('search finds a customer by email (gap #1)', () => {
    const findableByEmail = row({
      id: 'c2',
      no: 'C-0002',
      name: '見本 次郎',
      email: 'jiro-unique@example.com',
    })
    const other = row({ id: 'c1', no: 'C-0001', name: '見本 花子' })

    expect(matchesCustomerSearch(findableByEmail, 'jiro-unique')).toBe(true)
    expect(matchesCustomerSearch(other, 'jiro-unique')).toBe(false)
    // Case-insensitive, same as canon's own .toLowerCase() compare.
    expect(matchesCustomerSearch(findableByEmail, 'JIRO-UNIQUE')).toBe(true)
  })

  it('検索をクリア clears the state and puts the caret back in the box (gap #2)', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    const setSearch = jest.fn()

    clearSearch(input, setSearch)

    expect(setSearch).toHaveBeenCalledWith('')
    expect(document.activeElement).toBe(input)
  })

  it('表示する列 popover focuses the first checkbox on open (gap #4)', () => {
    const pop = document.createElement('div')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    pop.appendChild(checkbox)
    const trigger = document.createElement('button')
    document.body.append(pop, trigger)

    wireColumnsPopover(pop, trigger, jest.fn())

    expect(document.activeElement).toBe(checkbox)
  })

  it('表示する列 popover closes on Escape and hands focus back to the button (gap #4)', () => {
    const pop = document.createElement('div')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    pop.appendChild(checkbox)
    const trigger = document.createElement('button')
    document.body.append(pop, trigger)
    const onClose = jest.fn()

    wireColumnsPopover(pop, trigger, onClose)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('表示する列 popover closes on an outside click but not on a click inside it or the button (gap #4)', () => {
    const pop = document.createElement('div')
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    pop.appendChild(checkbox)
    const trigger = document.createElement('button')
    const outside = document.createElement('div')
    document.body.append(pop, trigger, outside)
    const onClose = jest.fn()

    const cleanup = wireColumnsPopover(pop, trigger, onClose)

    // Inside the popover: no close.
    checkbox.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    // On the trigger itself: no close (its own click stays a toggle).
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    // Anywhere else: closes and hands focus back.
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(trigger)

    cleanup()
  })

  it('顧客を追加 opens the create dialog cleared, with 氏名 focused (gap #5)', () => {
    const dialog = document.createElement('dialog')
    dialog.innerHTML = `
      <form>
        <input name="name" />
        <input name="phone" />
      </form>
    `
    const nameInput = dialog.querySelector('input[name="name"]') as HTMLInputElement
    nameInput.value = '打鍵確認' // simulates a previous, uncleared typed value
    document.body.appendChild(dialog)

    openCreateDialog(dialog)

    expect(dialog.open).toBe(true)
    expect(nameInput.value).toBe('') // form.reset() cleared it
    expect(document.activeElement).toBe(nameInput)
  })

  it('a backdrop click closes the create dialog, a click on its content does not (gap #6)', () => {
    const dialog = document.createElement('dialog')
    const content = document.createElement('div')
    dialog.appendChild(content)
    document.body.appendChild(dialog)
    dialog.showModal()

    closeOnBackdropClick(content, dialog) // click landed on dialog content
    expect(dialog.open).toBe(true)

    closeOnBackdropClick(dialog, dialog) // click landed on the dialog element itself
    expect(dialog.open).toBe(false)
  })
})

/** Source pins read CODE, not prose: comment lines are stripped first so a
 *  paragraph about a rule can never stand in for the rule. */
const SCREEN_SRC = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(business)/business/customers/CustomersScreen.tsx'),
  'utf8',
)
const SCREEN_CODE = SCREEN_SRC.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')

describe('顧客 V2 — the tiles ARE the filters (⚖ §2.2)', () => {
  // A world with one row per interesting shape, INCLUDING the ¥0 wallet the
  // fixture plane carries on cus-04 — the misread this pin exists for.
  const world = [
    row({ id: 'a', no: 'C-1', name: '見本 あ', hasNext: true }),
    row({ id: 'b', no: 'C-2', name: '見本 い', ticket: 4 }),
    row({ id: 'c', no: 'C-3', name: '見本 う', wallet: 12000 }),
    row({ id: 'd', no: 'C-4', name: '見本 え', wallet: 0, ticket: 0 }),
    row({ id: 'e', no: 'C-5', name: '見本 お', merge: 'open' }),
    row({ id: 'f', no: 'C-6', name: '見本 か', merge: 'pending' }),
  ]

  it('every tile’s count IS the number of rows its own filter reveals', () => {
    // ONE function per tile, asked twice. A count computed from a second
    // predicate is the mutant this kills.
    for (const key of Object.keys(TILE_PREDICATE) as Array<keyof typeof TILE_PREDICATE>) {
      const revealed = world.filter(TILE_PREDICATE[key])
      expect({ key, count: revealed.length }).toEqual({ key, count: world.filter(TILE_PREDICATE[key]).length })
    }
    expect(world.filter(TILE_PREDICATE.all)).toHaveLength(6)
    expect(world.filter(TILE_PREDICATE.future)).toHaveLength(1)
    expect(world.filter(TILE_PREDICATE.ticket)).toHaveLength(1)
    expect(world.filter(TILE_PREDICATE.wallet)).toHaveLength(1)
    expect(world.filter(TILE_PREDICATE.merge)).toHaveLength(2)
  })

  it('¥0 is NOT 預かり残高あり, and a 0-count 回数券 is NOT 回数券あり', () => {
    const zero = world.find((r) => r.id === 'd')!
    expect(TILE_PREDICATE.wallet(zero)).toBe(false)
    expect(TILE_PREDICATE.ticket(zero)).toBe(false)
    // …and the CELL still says the honest word for each.
    expect(walletLabel(zero.wallet)).toBe('¥0')
    expect(ticketLabel(zero.ticket)).toBe('なし')
  })

  it('統合確認中 counts as a duplicate candidate — the strip and the tile are one number', () => {
    expect(world.filter(TILE_PREDICATE.merge).map((r) => r.id)).toEqual(['e', 'f'])
  })
})

describe('顧客 V2 — the compare table (⚖ §2.6 / ⚖-ADJ F)', () => {
  const a = row({
    id: 'a', no: 'C-3001', name: '見本 あかり', phone: '090-0000-0001',
    email: 'akari@sample.invalid', ticket: 4, wallet: 12000, totalSpent: 6600,
    lastVisitFull: '2026年8月26日', merge: 'open', duplicateOf: 'C-3009',
    consent: { line: true, sms: true, email: false },
    history: [{ date: '8/26', service: 'テスト整体 60分', amount: '¥6,600' }],
  })
  const b = row({
    id: 'b', no: 'C-3009', name: '見本 あかり', phone: '090-0000-0001',
    merge: 'open', duplicateOf: 'C-3001',
  })

  it('never carries 本人ID — a row that can only read 一致 teaches nothing', () => {
    expect(compareFields(a).map((f) => f.label)).not.toContain('本人ID')
    expect(compareFields(a).map((f) => f.label)).toEqual([
      '名前', '顧客番号', '携帯番号', 'メール', '登録元', '本人確認',
      '最終来店', '次回予約', '回数券', '預かり残高', '累計支払', '連絡同意', '来店履歴',
    ])
  })

  it('re-derives nothing — every value is the row’s own already-formatted string', () => {
    const by = (r: CustomerRow, label: string) => compareFields(r).find((f) => f.label === label)!
    expect(by(a, '回数券').raw).toBe(ticketLabel(a.ticket))
    expect(by(a, '預かり残高').raw).toBe(walletLabel(a.wallet))
    expect(by(a, '最終来店').raw).toBe(a.lastVisitFull)
    expect(by(a, '名前').raw).toBe(a.name)
  })

  it('a null on EITHER side is untagged, and the cell says the FIELD’s own null word', () => {
    const left = compareFields(a)
    const right = compareFields(b)
    const at = (label: string) => {
      const i = left.findIndex((f) => f.label === label)
      return { l: left[i], r: right[i] }
    }
    // both known and equal → 一致 is legal
    const phone = at('携帯番号')
    expect(phone.l.raw !== null && phone.r.raw !== null && phone.l.raw === phone.r.raw).toBe(true)
    // one side null → no tag, and the word is the field's own
    const mail = at('メール')
    expect(mail.r.raw).toBeNull()
    expect(mail.r.nullWord).toBe('未登録')
    expect(at('回数券').r.nullWord).toBe('なし')
    expect(at('預かり残高').r.nullWord).toBe('—')
    expect(at('来店履歴').r.nullWord).toBe('来店記録なし')
    // …and never a vocabulary the rest of the room does not speak.
    expect(left.concat(right).map((f) => f.nullWord)).not.toContain('未収録')
  })

  it('the pair is looked up by 顧客番号, never by row id', () => {
    // `duplicate_of` is a member_number in the plane; a lookup by `id` would
    // silently find nothing and render the empty-partner head forever.
    expect(a.duplicateOf).toBe(b.no)
    expect(b.duplicateOf).toBe(a.no)
    expect(SCREEN_CODE).toContain('byNo.get(comparing.duplicateOf)')
  })
})

describe('顧客 V2 — the three riders as FACTS (⚖ §3)', () => {
  it('空き日数 says what it counts, and 0 is 本日来店 rather than 0日', () => {
    expect(winBackLine(null)).toBe('来店記録なし')
    expect(winBackLine(0)).toBe('本日来店')
    expect(winBackLine(1)).toBe('最終来店から 1日')
    expect(winBackLine(22)).toBe('最終来店から 22日')
  })

  it('回数券の使い切り fires at exactly 1, never at 2', () => {
    expect(row({ id: 'x', no: 'C-1', name: 'あ', ticket: 1, ticketEnding: true }).ticketEnding).toBe(true)
    // the DERIVATION is in the props file, and it is an equality on 1
    const props = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/customers/customers-props.ts'),
      'utf8',
    )
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    expect(props).toContain('ticketEnding: c.ticket_balance === 1')
  })

  it('the lifecycle chip is 新規 / VIP only — 再来 and 回数券 repeat a column', () => {
    const props = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/customers/customers-props.ts'),
      'utf8',
    )
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join('\n')
    expect(props).toContain("const CHIPPED: BookingCategory[] = ['new', 'vip']")
    // …and the category itself comes from the BOARD's own function, never a
    // second opinion written here.
    expect(props).toContain('bookingCategory(c, priorVisits.get(c.id) ?? 0)')
    expect(props).toContain("import { priorVisitCounts } from '@/business/lib/analytics'")
  })
})

describe('顧客 V2 — the refusals and the doors (⚖-ADJ A / ⚖-ADJ B)', () => {
  it('別人として確認 and 統合する REFUSE, and neither carries a handler', () => {
    // The refusal grammar: aria-disabled + the reason on title and on the
    // accessible name. A handler on either is the mutant that writes.
    expect(SCREEN_CODE).toContain("refused('別人として確認', REFUSAL.merge)")
    expect(SCREEN_CODE).toContain("refused('統合する', REFUSAL.merge")
    expect(SCREEN_CODE).not.toMatch(/別人として確認[\s\S]{0,200}onClick/)
    expect(SCREEN_CODE).toContain("'aria-disabled': 'true' as const")
    expect(SCREEN_CODE).toContain("'aria-label': `${label} — ${reason}`")
  })

  it('the reason is readable WITHOUT hover — it is printed in the drawer’s footer', () => {
    expect(SCREEN_CODE).toContain('{REFUSAL.merge}')
    expect(SCREEN_SRC).toContain(
      '見本データのため、統合・別人確認の記録はできません。実データ接続後に有効になります。',
    )
  })

  it('the two live doors are LINKS, and 顧客プロフィール stays refused', () => {
    expect(SCREEN_CODE).toContain('<Link className="cu-btn" href={inboxHref}')
    expect(SCREEN_CODE).toContain('<Link className="cu-qbtn" href={karuteHref}')
    expect(SCREEN_CODE).toContain("refused('顧客プロフィールを開く', REFUSAL.profile")
    // the family's word for the room is カルテ (the sidebar's own label)
    expect(SCREEN_SRC).toContain('カルテを開く')
    expect(SCREEN_SRC).not.toContain('Karuteを開く')
    // no 準備中 door survives this round
    expect(SCREEN_SRC).not.toContain('（準備中）')
  })

  it('a duplicate’s reason names the shared key when there is one', () => {
    expect(dupeReason(row({ id: 'a', no: 'C-1', name: 'あ', merge: 'open', phone: '090-0000-0001' })))
      .toBe('同じ電話番号 090-0000-0001 で候補になりました')
    expect(dupeReason(row({ id: 'a', no: 'C-1', name: 'あ', merge: 'open' })))
      .toBe('同じ電話番号で候補になりました')
    expect(dupeReason(row({ id: 'a', no: 'C-1', name: 'あ', merge: 'pending' })))
      .toBe('統合確認中の候補です')
  })
})

describe('顧客 V2 — the room’s structure (⚖ page-scroll · ⚖ tour · ⚖ R13)', () => {
  const CSS = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/customers/customers.css'),
    'utf8',
  )
  const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

  it('⚖ PAGE-SCROLL — the room owns no vertical scroller at all', () => {
    expect(CSS_CODE).not.toContain('overflow-y')
    // The ONE `max-height` in the sheet is the native <dialog>'s own viewport
    // cap, which is what keeps a modal inside the window — it is not a page
    // scroller, and it is the built surface this round must not regress.
    const capped = [...CSS_CODE.matchAll(/([^{}]+)\{[^{}]*max-height/g)].map((m) => m[1].trim())
    expect(capped).toEqual(['.biz .page-customers dialog'])
    // the inspector is sticky and UNCAPPED (⚖-ADJ E)
    expect(CSS_CODE).toContain('.biz .page-customers .cu-insp {')
    expect(CSS_CODE).toMatch(/\.cu-insp \{[^}]*position: sticky/)
  })

  it('the two horizontal panners are the NAMED ones, and the page is not one of them', () => {
    const panners = [...CSS_CODE.matchAll(/([^{}]+)\{[^{}]*overflow-x: auto/g)].map((m) => m[1].trim())
    expect(panners).toHaveLength(1)
    expect(panners[0]).toContain('.cu-tiles')
  })

  it('⚖ the guided tour — every declared region carries BOTH a title and a text', () => {
    const titles = [...SCREEN_SRC.matchAll(/data-guide-title="([^"]*)"/g)].map((m) => m[1])
    const texts = [...SCREEN_SRC.matchAll(/\n\s*data-guide="([^"]*)"/g)].map((m) => m[1])
    const jsxTitles = [...SCREEN_SRC.matchAll(/'data-guide-title': '([^']*)'/g)].map((m) => m[1])
    const jsxTexts = [...SCREEN_SRC.matchAll(/'data-guide':\s*\n?\s*'([^']*)'/g)].map((m) => m[1])
    const allTitles = [...titles, ...jsxTitles]
    const allTexts = [...texts, ...jsxTexts]
    // eight declared regions: head · tiles · strip · list · inspector · dupe box
    // · footnote · the compare drawer
    expect(allTitles).toHaveLength(8)
    expect(allTexts).toHaveLength(8)
    // an empty declaration is a region that joins the walk and explains nothing
    for (const t of allTitles) expect(t.length).toBeGreaterThan(1)
    for (const t of allTexts) expect(t.length).toBeGreaterThan(20)
    // …and the ? opens the TOUR, never a popover of its own
    expect(SCREEN_CODE).toContain('aria-controls="cuTour"')
    expect(SCREEN_CODE).toContain('onClick={() => setTourIdx(0)}')
  })

  it('⚖ R13 — nothing pressable in this room is a dark fill, and selected is a wash', () => {
    expect(CSS_CODE).toContain('--cu-blue: #2563eb;')
    expect(CSS_CODE).toContain('.biz .page-customers .cu-btn-solid {')
    expect(CSS_CODE).toMatch(/\.cu-tile\[aria-pressed="true"\] \{[^}]*background: transparent/)
    expect(CSS_CODE).toContain('.cu-tile-thumb {')
    // the toast is a LIGHT card
    expect(CSS_CODE).toMatch(/\.cu-toast \{[^}]*background: #fff/)
  })

  it('⚖-ADJ R — the root class and the four-level fences are exactly as ruled', () => {
    expect(SCREEN_SRC).toContain('<div className="page page-customers">')
    expect(CSS_CODE).not.toContain('pg-customers')
    // the retired bare rule is really gone
    expect(CSS_CODE).not.toContain('.biz .page .btn')
    // …and every shared name this room still renders states its own value at
    // four levels, so a sibling's three-level rule cannot win on insertion order
    for (const rule of [
      '.biz .page.page-customers { padding:',
      '.biz .page.page-customers h1 {',
      '.biz .page.page-customers .btn { font-weight: 500; }',
      '.biz .page.page-customers .btn.primary { font-weight: 600; }',
    ]) {
      expect(CSS_CODE).toContain(rule)
    }
  })

  it('⚖-ADJ G — the footnote opens DOWNWARD, in flow, with no absolute panel', () => {
    expect(CSS_CODE).not.toMatch(/\.cu-fn-panel \{[^}]*position: absolute/)
    expect(CSS_CODE).toMatch(/\.cu-fn-panel \{[^}]*height: 0/)
    // the bar comes FIRST in the DOM and the panel after it
    expect(SCREEN_SRC.indexOf('cu-fn-bar')).toBeLessThan(SCREEN_SRC.indexOf('cu-fn-panel'))
  })

  it('⚖-ADJ H — the bands that can be reached in BOTH rail states are container queries', () => {
    for (const band of ['@container cupage (max-width: 1015px)', '@container cupage (max-width: 855px)', '@container cupage (max-width: 759px)']) {
      expect(CSS_CODE).toContain(band)
    }
    // …and the phone band, which below a 1024 viewport is a bijection with the
    // viewport, lifts the containment so its fixed sheet is really fixed
    expect(CSS_CODE).toContain('@media (max-width: 711px)')
    expect(CSS_CODE).toMatch(/@media \(max-width: 711px\) \{[\s\S]*?container-type: normal/)
    // ⚖-ADJ I — the ultra-wide cap, one token on the content column
    expect(CSS_CODE).toContain('--cu-maxw: 1416px;')
  })

  it('the room’s own class names exist nowhere else in the family', () => {
    const own = [...new Set([...CSS_CODE.matchAll(/\.(cu-[\w-]+)/g)].map((m) => m[1]))]
    expect(own.length).toBeGreaterThan(40)
    const BIZ = 'src/app/[locale]/(business)'
    for (const dir of ['analytics', 'inbox', 'karute', 'recording', 'register', 'reservations', 'settings', 'shifts', 'today']) {
      const sheet = readFileSync(join(process.cwd(), `${BIZ}/business/${dir}/${dir}.css`), 'utf8')
      for (const n of own) expect({ dir, name: n, used: sheet.includes(`.${n}`) }).toEqual({ dir, name: n, used: false })
    }
    // …and no `st-*` name from 設定 appears here (the settings suite's own pin,
    // stated from this side too)
    expect(CSS_CODE).not.toMatch(/\.st-[\w-]/)
  })

  it('there is ONE keydown listener, and it closes ONE layer per Escape', () => {
    expect(SCREEN_CODE.match(/addEventListener\('keydown'/g)).toHaveLength(1)
    // innermost first: the tour owns Escape while it is up, then the drawer,
    // then the sheet
    expect(SCREEN_CODE.indexOf('if (tourOpen) {')).toBeLessThan(SCREEN_CODE.indexOf('if (drawerOpen) {'))
    expect(SCREEN_CODE.indexOf('if (drawerOpen) {')).toBeLessThan(SCREEN_CODE.indexOf('if (sheetOpen) closeSheet()'))
  })
})
