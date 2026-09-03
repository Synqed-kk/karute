/**
 * @jest-environment jsdom
 *
 * Business 予約一覧 — interaction-parity tests (PACKET-PARITY-WAVE-2026-08-19
 * WO-3b: "Interaction tests for: chip selection, column popover, dialog gates +
 * each transition, 8-state branching").
 *
 * MECHANISM (ADDENDUM 3, superseding Addendum 2's RTL line): @testing-library
 * does not resolve under territory's import fence (react/next/node: only), so
 * the DOM-touching handlers are extracted as small functions parameterized on
 * real DOM nodes and driven here with plain jsdom — globals only, zero extra
 * imports. Same house pattern as customers-screen-interactions.test.ts.
 *
 * The 表示する列 popover WIRING itself (focus-in, Escape, outside-click) is one
 * shared canon primitive tested once in that sibling suite; what is tested here
 * is 予約一覧's own five-column set driving it, which is the part that can
 * differ per screen.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toggleColumn, wireColumnsPopover } from '@/business/lib/column-config'
import {
  CHIP_LABEL,
  CHIP_VIEWS,
  NEEDS_STAFF,
  PAGE_BANDS,
  WANTS_CHANGE,
  countdownText,
  matchesFilters,
  noShowCountOf,
  primaryActionOf,
  priceUnmatched,
  viewFilters,
  type Lifecycle,
} from '@/business/lib/reservations'
import {
  COLUMNS,
  acceptCommit,
  changeCommit,
  decorate,
  focusResult,
  recordCommit,
  wireSheet,
  type ReservationRow,
  type SlotOption,
} from '@/app/[locale]/(business)/business/reservations/ReservationsScreen'

/** 13:24 JST, the one pinned world clock the whole fixture day runs on. */
const NOW = 13 * 60 + 24
/** 閉店 21:00 — 精算期限 IS this, never a stored second copy. */
const CLOSE = 21 * 60

function row(over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: 'apt-1',
    no: 'R-4838',
    dateLabel: '8月20日',
    dayLabel: '8月20日(木)',
    dayKey: 20260820,
    isToday: true,
    startMinute: 14 * 60 + 30,
    durationMinutes: 60,
    startLabel: '14:30',
    timeLabel: '14:30–15:30',
    customerName: '見本 まお',
    menuName: 'テスト整体 60分',
    staffName: '見本 はなこ',
    resourceName: 'ベッド1',
    sourceLabel: 'Reserve',
    sourceGroup: 'reserve',
    sourceRef: '#357552',
    priceLabel: '¥6,600',
    currentPriceLabel: '¥7,130',
    storeLabel: null,
    lifecycle: 'confirmed',
    flags: [],
    reassigned: false,
    deadline: null,
    eligibility: '単発オンライン / 対象',
    proof: '受付価格は受付時のまま保持しています。',
    party: [],
    history: [],
    shiftWarning: null,
    qualificationText: '整体・小顔対応済み',
    staffUnavailable: false,
    settled: false,
    noShowCount: 0,
    txNote: '未作成 — 閉店処理を止めています',
    txDetail: null,
    ...over,
  }
}

const dec = (over: Partial<ReservationRow> = {}) => decorate(row(over), NOW, CLOSE)

const SLOT: SlotOption = {
  id: 'slot-01',
  start: 16 * 60,
  end: 17 * 60,
  staffName: '見本 しろう',
  resourceName: 'ベッド2',
}

// ─── ⚖-ADJ D · the counts ARE the filters ─────────────────────────────────
describe('a chip stores CRITERIA, never a cached row set', () => {
  /** RE-PINNED ON THE NEW SHAPE (V2). The four canon mappings are unchanged
   *  where they stood — `date`/`status`/`source`/`search` read exactly what
   *  `applySavedView` set (w2-bookings-customers.js:734-745) — and three things
   *  moved, each named:
   *    · every view gains the `price` axis (⚖-ADJ E), `all` on five of six;
   *    · 精算待ち and 本日 JOIN as chips: they used to be summary tiles nobody
   *      could press, and the accepted mock makes every number pressable;
   *    · 一致なし stops being a search that matches nothing and becomes the real
   *      price-照合 job. The empty-result view stays survivable — it is what a
   *      search matching nothing still does, pinned in `reservations.test.ts`
   *      («the search covers the four fields canon names», `__一致なし__` → 0). */
  it.each([
    ['all', { date: 'all', status: 'all', source: 'all', price: 'all', search: '' }],
    ['attention', { date: 'all', status: 'attention', source: 'all', price: 'all', search: '' }],
    ['settling', { date: 'all', status: 'awaiting_settlement', source: 'all', price: 'all', search: '' }],
    ['today', { date: 'today', status: 'all', source: 'all', price: 'all', search: '' }],
    ['reserve', { date: 'all', status: 'all', source: 'reserve', price: 'all', search: '' }],
    ['none', { date: 'all', status: 'all', source: 'all', price: 'unmatched', search: '' }],
  ] as const)('「%s」 sets exactly these filter values', (view, expected) => {
    expect(viewFilters(view)).toEqual(expected)
  })

  it('every chip lands on a DIFFERENT criteria set — no two chips are the same chip', () => {
    const seen = CHIP_VIEWS.map((v) => JSON.stringify(viewFilters(v)))
    expect(new Set(seen).size).toBe(CHIP_VIEWS.length)
  })

  it('the chip row is the mock\'s own six, in the mock\'s own order, each with a label', () => {
    expect(CHIP_VIEWS).toEqual(['all', 'attention', 'settling', 'today', 'reserve', 'none'])
    expect(CHIP_VIEWS.map((v) => CHIP_LABEL[v])).toEqual([
      'すべて', '要対応', '精算待ち', '本日', 'Reserve受付', '一致なしを確認',
    ])
  })

  it('本日 really sets the DATE — the range select follows the chip rather than contradicting it', () => {
    expect(viewFilters('today').date).toBe('today')
    expect(CHIP_VIEWS.filter((v) => viewFilters(v).date === 'today')).toEqual(['today'])
  })

  it('精算待ち selects the settlement lifecycle and nothing else', () => {
    expect(viewFilters('settling').status).toBe('awaiting_settlement')
  })
})

// ─── ⚖-ADJ E · 一致なしを確認 = the rows whose two prices cannot be reconciled ─
describe('受付価格の照合', () => {
  const priced = (priceLabel: string, currentPriceLabel: string) => ({ priceLabel, currentPriceLabel })

  it('a row whose two figures agree is MATCHED', () => {
    expect(priceUnmatched(priced('¥6,600', '¥6,600'))).toBe(false)
  })

  it('a missing 受付価格 can never equal the published figure beside it', () => {
    expect(priceUnmatched(priced('受付価格の記録なし', '¥6,600'))).toBe(true)
  })

  it('a missing 公開価格 counts too, and so does a plain difference', () => {
    expect(priceUnmatched(priced('¥6,600', '公開価格の記録なし'))).toBe(true)
    expect(priceUnmatched(priced('受付価格の記録なし', '公開価格の記録なし'))).toBe(true)
    expect(priceUnmatched(priced('¥6,600', '¥7,130'))).toBe(true)
  })

  it('the filter READS that predicate rather than re-deriving it', () => {
    const base = { no: 'R-1', customerName: 'x', menuName: 'y', staffName: 'z', isToday: true, lifecycle: 'confirmed' as Lifecycle, sourceGroup: 'store' as const, queued: false }
    const unmatched = { ...base, ...priced('受付価格の記録なし', '¥6,600') }
    const matched = { ...base, ...priced('¥6,600', '¥6,600') }
    const f = viewFilters('none')
    expect(matchesFilters(unmatched, f)).toBe(true)
    expect(matchesFilters(matched, f)).toBe(false)
    // …and every other chip leaves the axis alone
    for (const v of CHIP_VIEWS.filter((x) => x !== 'none')) expect(viewFilters(v).price).toBe('all')
  })
})

// ─── ⚖-ADJ J/M · the live countdown ───────────────────────────────────────
describe('countdownText — the mock’s own cdText, ported', () => {
  /** The five rail cards of the 銀座 world at elapsed 0, byte for byte off the
   *  mock's accepted 1280 shot. Deadlines are JST minutes; NOW is 13:24. */
  it.each([
    [12 * 60 + 30, '期限超過 54分00秒'],
    [13 * 60 + 45, 'あと21分00秒'],
    [14 * 60, 'あと36分00秒'],
    [16 * 60 + 30, 'あと3時間6分00秒'],
    [19 * 60, 'あと5時間36分00秒'],
  ])('%i reads %s at elapsed 0', (deadline, text) => {
    expect(countdownText(deadline, NOW, 0)).toBe(text)
  })

  it('seconds always carry two digits, so the number never changes width', () => {
    expect(countdownText(14 * 60, NOW, 1)).toBe('あと35分59秒')
    expect(countdownText(14 * 60, NOW, 55)).toBe('あと35分05秒')
    expect(countdownText(14 * 60, NOW, 60 * 35 + 59)).toBe('あと0分01秒')
  })

  it('hours appear only when there is at least one, on BOTH sides of zero', () => {
    expect(countdownText(NOW + 59, NOW, 0)).toBe('あと59分00秒')
    expect(countdownText(NOW + 60, NOW, 0)).toBe('あと1時間0分00秒')
    expect(countdownText(NOW - 59, NOW, 0)).toBe('期限超過 59分00秒')
    expect(countdownText(NOW - 60, NOW, 0)).toBe('期限超過 1時間0分00秒')
  })

  it('crossing zero flips to 期限超過 and keeps counting', () => {
    expect(countdownText(14 * 60, NOW, 60 * 36)).toBe('期限超過 0分00秒')
    expect(countdownText(14 * 60, NOW, 60 * 36 + 7)).toBe('期限超過 0分07秒')
  })
})

// ─── ⚖ rider #3 · 来店なし memory ──────────────────────────────────────────
describe('noShowCountOf — the customer’s own past, inside the lens', () => {
  const NOWPT = { dayKey: 20260903, minute: 13 * 60 + 24 }
  const r = (id: string, over: Partial<{ customerId: string; boardState: string | null; dayKey: number; endMinute: number }> = {}) => ({
    id,
    customerId: 'cus-1',
    boardState: 'noshow' as string | null,
    dayKey: 20260901,
    endMinute: 12 * 60,
    ...over,
  })

  it('counts the customer’s no-shows and nobody else’s', () => {
    expect(noShowCountOf([r('a'), r('b', { customerId: 'cus-2' })], 'cus-1', 'z', NOWPT)).toBe(1)
  })

  it('a booking that has not happened yet is not a no-show', () => {
    expect(noShowCountOf([r('a', { dayKey: 20260904 })], 'cus-1', 'z', NOWPT)).toBe(0)
    // …and TODAY is cut at the pinned minute, never at a wall clock
    expect(noShowCountOf([r('a', { dayKey: 20260903, endMinute: 13 * 60 + 25 })], 'cus-1', 'z', NOWPT)).toBe(0)
    expect(noShowCountOf([r('a', { dayKey: 20260903, endMinute: 13 * 60 + 24 })], 'cus-1', 'z', NOWPT)).toBe(1)
  })

  it('only a 来店なし row counts — a kept or cancelled booking is not one', () => {
    expect(noShowCountOf([r('a', { boardState: 'confirmed' }), r('b', { boardState: null })], 'cus-1', 'z', NOWPT)).toBe(0)
  })

  it('a booking never counts ITSELF — the tag is memory about the other visits', () => {
    expect(noShowCountOf([r('a')], 'cus-1', 'a', NOWPT)).toBe(0)
    expect(noShowCountOf([r('a'), r('b')], 'cus-1', 'a', NOWPT)).toBe(1)
  })
})

// ─── ⚖ the ladder’s own numbers ───────────────────────────────────────────
describe('PAGE_BANDS — one page width, one answer', () => {
  it('is monotonic and strictly ordered', () => {
    expect(PAGE_BANDS.narrow).toBeGreaterThan(PAGE_BANDS.oneColumn)
    expect(PAGE_BANDS.oneColumn).toBeGreaterThan(PAGE_BANDS.phone)
  })

  it('the SHEET carries exactly these three numbers — one home, never two', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business/reservations/reservations.css'), 'utf8')
    for (const n of [PAGE_BANDS.narrow, PAGE_BANDS.oneColumn, PAGE_BANDS.phone]) {
      expect(css).toContain(`@container rvpage (max-width: ${n}px)`)
    }
    // …and no fourth band width slipped in beside them
    const widths = [...css.matchAll(/@container rvpage \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]))
    expect([...new Set(widths)].sort((a, b) => b - a)).toEqual([PAGE_BANDS.narrow, PAGE_BANDS.oneColumn, PAGE_BANDS.phone])
  })
})

// ─── 表示する列 popover ────────────────────────────────────────────────────
describe('表示する列 popover — 予約一覧\'s own five columns', () => {
  it('canon\'s five columns all start visible (this panel lists none as off)', () => {
    expect(COLUMNS.map((c) => c.k)).toEqual(['when', 'who', 'staff', 'source', 'state'])
    expect(COLUMNS.map((c) => c.label)).toEqual(['日時', 'お客様・メニュー', '担当・設備', '受付元・価格', '状態'])
  })

  it('every column can be hidden, but the LAST visible one refuses to go', () => {
    // canon fable-shared.js:190-193 — an all-hidden list is a broken screen.
    let shown: string[] = COLUMNS.map((c) => c.k)
    for (const c of COLUMNS.slice(0, 4)) shown = toggleColumn(shown, c.k)
    expect(shown).toEqual(['state'])
    expect(toggleColumn(shown, 'state')).toEqual(['state'])
    // …and it comes back.
    expect(toggleColumn(shown, 'when')).toEqual(['state', 'when'])
  })

  it('Escape closes the popover and hands focus back to 表示設定', () => {
    const { pop, trigger, closed } = mountPopover()
    expect(document.activeElement).toBe(pop.querySelector('input'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(closed()).toBe(1)
    expect(document.activeElement).toBe(trigger)
  })

  it('a click outside closes it; a click on a checkbox inside does not', () => {
    const { pop, trigger, closed, cleanup } = mountPopover()
    pop.querySelector('input')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(closed()).toBe(0)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    expect(closed()).toBe(1)
    expect(document.activeElement).toBe(trigger)
    cleanup()
  })
})

/** The popover as the screen builds it: one checkbox per canon column. */
function mountPopover() {
  document.body.innerHTML = ''
  const trigger = document.createElement('button')
  trigger.textContent = '表示設定'
  const pop = document.createElement('div')
  pop.setAttribute('role', 'dialog')
  for (const c of COLUMNS) {
    const label = document.createElement('label')
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = true
    label.append(input, document.createTextNode(c.label))
    pop.append(label)
  }
  document.body.append(trigger, pop)
  let count = 0
  const cleanup = wireColumnsPopover(pop, trigger, () => (count += 1))
  return { pop, trigger, closed: () => count, cleanup }
}

// ─── inspector primary action — canon's 8-state branching (:658-667) ───────
describe('inspector primary action branches on state + flags, never on an id', () => {
  const P = (lifecycle: Lifecycle, flags: string[] = [], deadline: number | null = null) =>
    primaryActionOf(lifecycle, flags, deadline)

  it('担当変更が必要 outranks EVERY lifecycle — it is the flag that stops the day', () => {
    expect(P('pending_accept', [NEEDS_STAFF], 15 * 60)).toBe('escalate')
    expect(P('confirmed', [NEEDS_STAFF])).toBe('escalate')
    expect(P('awaiting_settlement', [NEEDS_STAFF], CLOSE)).toBe('escalate')
    expect(P('cancelled', [NEEDS_STAFF])).toBe('escalate')
  })

  it('変更希望あり outranks the lifecycle too, but yields to 担当変更が必要', () => {
    expect(P('confirmed', [WANTS_CHANGE], 15 * 60)).toBe('change')
    expect(P('pending_accept', [WANTS_CHANGE], 15 * 60)).toBe('change')
    expect(P('confirmed', [NEEDS_STAFF, WANTS_CHANGE])).toBe('escalate')
  })

  it('受付リクエストを確認 needs the booking to STILL be queued', () => {
    // The branch canon guards with `kind==='accept' && isQueued(item)`: a
    // 受付判断 whose deadline is gone is no longer a decision this screen takes,
    // so it falls through to the 受信トレイ branch instead of offering a dialog
    // that would refuse at commit time.
    expect(P('pending_accept', [], 15 * 60)).toBe('accept')
    expect(P('pending_accept', [], null)).toBe('propose')
  })

  it('the five remaining lifecycles each reach their own action', () => {
    expect(P('awaiting_settlement', [], CLOSE)).toBe('settle')
    expect(P('external', [])).toBe('external')
    expect(P('confirmed', [])).toBe('record')
    expect(P('cancelled', [])).toBe('contact')
    expect(P('no_show', [])).toBe('contact')
  })

  it('a settled booking falls all the way through to 今日の運営で見る', () => {
    expect(P('settled', [])).toBe('today')
  })

  it('all nine branches are reachable — no dead arm in the chain', () => {
    const reached = new Set([
      P('confirmed', [NEEDS_STAFF]),
      P('confirmed', [WANTS_CHANGE]),
      P('pending_accept', [], 15 * 60),
      P('awaiting_settlement', [], CLOSE),
      P('external', []),
      P('confirmed', []),
      P('pending_accept', [], null),
      P('cancelled', []),
      P('settled', []),
    ])
    expect(reached.size).toBe(9)
  })
})

// ─── dialog gates + client-state transitions ──────────────────────────────
describe('受付 dialog — gate and transition', () => {
  const pending = { lifecycle: 'pending_accept' as Lifecycle, deadline: 15 * 60 }

  it('refuses without the checkbox', () => {
    expect(acceptCommit(dec(pending), false, '見本サンプル整体', NOW)).toBeNull()
  })

  it('refuses on a row that is not an acceptance decision, checkbox or not', () => {
    expect(acceptCommit(dec(), true, '見本サンプル整体', NOW)).toBeNull()
    expect(acceptCommit(dec({ ...pending, flags: [WANTS_CHANGE] }), true, '見本サンプル整体', NOW)).toBeNull()
  })

  it('refuses a 受付判断 whose deadline is already gone (canon\'s isQueued gate)', () => {
    expect(acceptCommit(dec({ lifecycle: 'pending_accept', deadline: null }), true, '見本サンプル整体', NOW)).toBeNull()
  })

  it('flips 受付判断 → 確定 and drops the deadline, so the row leaves the queue', () => {
    const commit = acceptCommit(dec(pending), true, '見本サンプル整体', NOW)!
    expect(commit.patch.lifecycle).toBe('confirmed')
    expect(commit.patch.deadline).toBeNull()
    // The queue reads the SAME predicate the row does, so this one patch moves
    // the pill, the tile and the queue card together or not at all.
    expect(decorate({ ...row(pending), ...commit.patch }, NOW, CLOSE).queued).toBe(false)
  })

  it('stamps the history at the world clock, newest first, price preserved', () => {
    const commit = acceptCommit(dec({ ...pending, history: [['09:00', '既存', '行']] }), true, '見本サンプル整体', NOW)!
    expect(commit.patch.history![0]).toEqual([
      '13:24',
      '受付リクエストを確定',
      '見本サンプル整体 / ¥6,600保持 / Reserve通知 + SMS送信',
    ])
    expect(commit.patch.history![1]).toEqual(['09:00', '既存', '行'])
  })
})

describe('変更 dialog — 「画面内で変更を試す」 in-page trial move', () => {
  const wants = { lifecycle: 'confirmed' as Lifecycle, flags: [WANTS_CHANGE], deadline: 15 * 60 }

  it('refuses without a slot, a reason, or the checkbox', () => {
    expect(changeCommit(dec(wants), undefined, 'お客様希望', true, NOW)).toBeNull()
    expect(changeCommit(dec(wants), SLOT, '', true, NOW)).toBeNull()
    expect(changeCommit(dec(wants), SLOT, 'お客様希望', false, NOW)).toBeNull()
  })

  it('refuses on a booking that never asked for a change', () => {
    expect(changeCommit(dec(), SLOT, 'お客様希望', true, NOW)).toBeNull()
  })

  it('moves time, staff and bed — and NEVER the day', () => {
    const before = dec(wants)
    const commit = changeCommit(before, SLOT, 'お客様希望', true, NOW)!
    expect(commit.patch.timeLabel).toBe('16:00–17:00')
    expect(commit.patch.startMinute).toBe(16 * 60)
    expect(commit.patch.staffName).toBe('見本 しろう')
    expect(commit.patch.resourceName).toBe('ベッド2')
    // 販売可能枠 are a daily shape offered on the booking's own date; moving the
    // day would be a different appointment, not a change.
    expect(commit.patch).not.toHaveProperty('dateLabel')
    expect(commit.patch).not.toHaveProperty('dayKey')
  })

  it('the agreed price is carried untouched and said so in the 根拠', () => {
    const commit = changeCommit(dec(wants), SLOT, 'お客様希望', true, NOW)!
    expect(commit.patch).not.toHaveProperty('priceLabel')
    expect(commit.patch.proof).toContain('受付価格 ¥6,600は変更していません')
    expect(commit.patch.proof).toContain('元の 8月20日 14:30–15:30 / 見本 はなこ / ベッド1を履歴に保持')
  })

  it('変更希望あり comes off, 担当変更あり goes on when the person actually changed', () => {
    const moved = changeCommit(dec(wants), SLOT, 'お客様希望', true, NOW)!
    expect(moved.patch.flags).not.toContain(WANTS_CHANGE)
    expect(moved.patch.reassigned).toBe(true)
    expect(decorate({ ...row(wants), ...moved.patch }, NOW, CLOSE).allFlags).toContain('担当変更あり')

    // Same bed and same person = a time move only, and no 担当変更あり is claimed.
    const sameStaff = changeCommit(dec(wants), { ...SLOT, staffName: '見本 はなこ' }, 'お客様希望', true, NOW)!
    expect(sameStaff.patch.reassigned).toBe(false)
  })

  it('leaves the queue: 確定 with no deadline', () => {
    const commit = changeCommit(dec(wants), SLOT, '担当者の勤務変更', true, NOW)!
    expect(commit.patch.lifecycle).toBe('confirmed')
    expect(decorate({ ...row(wants), ...commit.patch }, NOW, CLOSE).queued).toBe(false)
  })
})

describe('記録 dialog — three outcomes, and none of them deletes the booking', () => {
  it('refuses unless the row is 確定 and all three inputs are given', () => {
    expect(recordCommit(dec(), 'arrived', '電話で本人確認', false, '店', NOW)).toBeNull()
    expect(recordCommit(dec(), '', '電話で本人確認', true, '店', NOW)).toBeNull()
    expect(recordCommit(dec(), 'arrived', '', true, '店', NOW)).toBeNull()
    expect(recordCommit(dec({ lifecycle: 'settled' }), 'arrived', '電話で本人確認', true, '店', NOW)).toBeNull()
  })

  it('来店済み・精算へ → 精算待ち, and the row RE-ENTERS the queue at 閉店', () => {
    const commit = recordCommit(dec(), 'arrived', '店頭で確認', true, '店', NOW)!
    expect(commit.patch.lifecycle).toBe('awaiting_settlement')
    // 精算期限 IS 閉店 (deadlineOf), so clearing the stored deadline does not
    // clear the obligation — the card comes back as a settlement.
    const after = decorate({ ...row(), ...commit.patch }, NOW, CLOSE)
    expect(after.queued).toBe(true)
    expect(after.deadlineMinute).toBe(CLOSE)
    expect(after.kind).toBe('settle')
  })

  it('お客様キャンセル → 取消, out of the queue, booking still there', () => {
    const commit = recordCommit(dec(), 'cancelled', '電話で本人確認', true, '店', NOW)!
    expect(commit.patch.lifecycle).toBe('cancelled')
    expect(decorate({ ...row(), ...commit.patch }, NOW, CLOSE).queued).toBe(false)
    expect(commit.patch.proof).toContain('お客様キャンセル。確認元: 電話で本人確認。')
  })

  it('無断キャンセル → 来店なし (not 取消): no contact AND no visit', () => {
    const commit = recordCommit(dec(), 'no_show', 'SMS送信・返答なし', true, '店', NOW)!
    expect(commit.patch.lifecycle).toBe('no_show')
    expect(commit.patch.history![0][1]).toBe('無断キャンセル')
    expect(commit.message).toContain('無断キャンセルと連絡証拠')
  })

  it('every outcome keeps the agreed price and the original slot in the 根拠', () => {
    for (const outcome of ['arrived', 'cancelled', 'no_show']) {
      const commit = recordCommit(dec(), outcome, '店頭で確認', true, '店', NOW)!
      expect(commit.patch.proof).toContain('受付価格 ¥6,600と元の予約枠を履歴に保持')
    }
  })
})

// ─── focus handoff (canon focusResult, :541) ──────────────────────────────
describe('a commit hands focus to the row it changed', () => {
  function list(ids: string[]) {
    document.body.innerHTML = ''
    const el = document.createElement('div')
    for (const id of ids) {
      const b = document.createElement('button')
      b.className = 'rv-row'
      b.dataset.id = id
      el.append(b)
    }
    const count = document.createElement('span')
    count.tabIndex = -1
    document.body.append(el, count)
    return { el, count }
  }

  it('focuses the changed row when it is on the list', () => {
    const { el, count } = list(['apt-1', 'apt-2'])
    focusResult(el, count, 'apt-2')
    expect((document.activeElement as HTMLElement).dataset.id).toBe('apt-2')
  })

  it('falls back to the first row when the changed booking is filtered out', () => {
    const { el, count } = list(['apt-1', 'apt-2'])
    focusResult(el, count, 'apt-9')
    expect((document.activeElement as HTMLElement).dataset.id).toBe('apt-1')
  })

  it('falls back to the result count when nothing matched at all', () => {
    const { el, count } = list([])
    focusResult(el, count, 'apt-9')
    expect(document.activeElement).toBe(count)
  })
})


// ═══ ⚖ 8/23 — 画面の説明, THE CENSUS FROM THE SOURCE SIDE ═══════════════════
//
// A census that only counts what declared itself is a TAUTOLOGY (the room-6
// fix-1 lesson): both sides compare declarations to declarations, so a section
// that never declared itself is absent from both. The list below is the view
// from OUTSIDE — it names every region this screen must explain, in the page's
// own order — so a declaration that goes missing is a RED rather than a smaller
// number. The BROWSER half (walked == declared, at three states) is the probe's.

const SCREEN_SRC = readFileSync(
  join(process.cwd(), 'src/app/[locale]/(business)/business/reservations/ReservationsScreen.tsx'),
  'utf8',
)
const SCREEN_CODE = SCREEN_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const DECLARATIONS = [
  ...SCREEN_CODE.matchAll(/data-guide-title="([^"]*)"\s*\n\s*data-guide="([^"]*)"/g),
].map((m) => ({ title: m[1], text: m[2] }))

describe('⚖ 8/23 — the guided tour declares every region this room renders', () => {
  it('the screen declares EXACTLY these regions, in the page’s own order', () => {
    expect(DECLARATIONS.map((d) => d.title)).toEqual([
      '予約一覧',
      '要対応',
      'この対応の中身',
      '絞り込み',
      '全予約リスト',
      '予約の詳細',
      // the phone / one-column sheet, which is the SAME inspector in its overlay
      // shell — only one of the two is ever on screen, so the walk sees one
      '予約の詳細',
    ])
  })

  it('the expected list is a LITERAL, never derived from the declarations it checks', () => {
    // the anti-tautology guard: this file's own source has to contain the six
    // names as quoted strings, so the pin cannot be satisfied by the screen
    // simply agreeing with itself.
    const own = readFileSync(join(process.cwd(), 'src/__tests__/integration/business/reservations-screen-interactions.test.ts'), 'utf8')
    for (const title of ['予約一覧', '要対応', 'この対応の中身', '絞り込み', '全予約リスト', '予約の詳細']) {
      expect(own).toContain(`      '${title}',`)
    }
    expect(own).not.toContain('DECLARATIONS.map((d) => d.title))\n    })')
  })

  it('every <section>, <header> and <aside> the LIVE screen renders declares itself', () => {
    /** ⚠ M-87's FAILURE STRIP IS OUT OF SCOPE, and deliberately: that branch
     *  renders when the reads threw, it carries no figure and no control, and a
     *  guided tour of a screen that could not load would be explaining numbers
     *  that are not there. It is the ONE excluded region and it is excluded BY
     *  NAME — everything after it is the live screen. */
    const live = SCREEN_CODE.slice(SCREEN_CODE.indexOf('function Screen(props: ReservationsProps)'))
    expect(live.length).toBeGreaterThan(1000)
    const undeclared: string[] = []
    for (const m of live.matchAll(/<(section|header|aside)\b([\s\S]*?)>/g)) {
      const attrs = m[2]
      if (!attrs.includes('data-guide-title=') || !attrs.includes('data-guide=')) {
        undeclared.push(`<${m[1]} ${attrs.slice(0, 80).replace(/\s+/g, ' ').trim()}…>`)
      }
    }
    expect(undeclared).toEqual([])
    // …and the failure strip really is the thing that was left out
    const failed = SCREEN_CODE.slice(0, SCREEN_CODE.indexOf('function Screen(props: ReservationsProps)'))
    expect(failed).toContain('rv-loaderror')
    expect(failed).not.toContain('data-guide')
  })

  it('every declaration is PAIRED, non-empty, and written in native Japanese', () => {
    expect(DECLARATIONS.length).toBe([...SCREEN_CODE.matchAll(/data-guide-title="/g)].length)
    expect(DECLARATIONS.length).toBe([...SCREEN_CODE.matchAll(/data-guide="/g)].length)
    for (const d of DECLARATIONS) {
      expect(d.title.trim().length).toBeGreaterThan(0)
      expect(d.text.trim().length).toBeGreaterThan(20)
      // ⚖ no em-dash joining two clauses — the one English habit this family's
      // otherwise natural copy keeps borrowing (the 9/1 native pass)
      expect(d.text).not.toContain(' — ')
    }
  })

  /** ⚖ N — EVERY RETIRED STRING HAS A NEW HOME. The head's own text is where the
   *  old subtitle and the summary band's sentence went, and the rail's is where
   *  the queue section's 対応期限の早い順 explanation went. A retirement with no
   *  home is a sentence the product simply stopped saying. */
  it('the retired sentences really moved into the tour rather than being cut', () => {
    const head = DECLARATIONS.find((d) => d.title === '予約一覧')!.text
    expect(head).toContain('期限のある予約判断')
    expect(head).toContain('日をまたぐ予約の検索・例外処理・証拠確認に使います')
    expect(head).toContain('見本データ')
    expect(DECLARATIONS.find((d) => d.title === '要対応')!.text).toContain('対応期限の早い順')
    expect(DECLARATIONS.find((d) => d.title === '絞り込み')!.text).toContain('件数のチップ')
    expect(DECLARATIONS.find((d) => d.title === '予約の詳細')!.text).toContain('現在の公開価格')
  })
})

// ═══ ⚖ THE SIBLING-SHEET FENCE, DERIVED FROM TODAY'S SHEETS ════════════════
//
// `.pg-reservations` keeps this room's rules OFF the neighbours and does nothing
// to keep theirs OFF this room: App Router leaves every sibling sheet in the
// document after a soft-nav. The fence here is STRUCTURAL — every element this
// room owns carries an `rv-` name that exists nowhere else — so what this test
// checks is that the structure really holds against the sheets as they are TODAY.

describe('⚖ the sibling-sheet fence, derived rather than enumerated', () => {
  const BIZ = join(process.cwd(), 'src/app/[locale]/(business)')
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '')
  /** ⚠ WALKS THE AT-RULES (the room-5 F-K11 defect). Splitting on '}' and
   *  slicing to the first '{' is blind to the FIRST rule of every @media block —
   *  the query's own brace is the one it finds — so a bare `.biz .<name>` rule
   *  planted first inside a media query stays invisible, which is precisely the
   *  shape this fence exists to catch. */
  const selectorsOf = (src: string) =>
    stripComments(src)
      .replace(/@(?:keyframes|font-face|counter-style|property)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .replace(/@(?:media|supports|layer|container)[^{]*\{/g, '')
      .split('}')
      .flatMap((block) => {
        const i = block.indexOf('{')
        return i < 0 ? [] : block.slice(0, i).split(',').map((x) => x.trim()).filter(Boolean)
      })
      .filter((x) => x !== '' && !x.startsWith('@'))
  const classesIn = (sel: string) => [...sel.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((n) => n !== 'biz')

  /** Every class name this room can be wearing — the UNION of what its MARKUP
   *  writes and what its own SHEET selects, so a name the sheet forgot and a
   *  name the markup dropped are both still fenced.
   *
   *  ⚠ A CLASS TOKEN IN THIS ROOM IS ONE OF FOUR FAMILIES: `rv-*` (everything
   *  this room owns), `is-*` (its states), `pg-*` (its root) or one of the shell
   *  primitives below. Filtering to those is what keeps a JS identifier out of
   *  the set — an expression inside a template className mentions `chip` as a
   *  VARIABLE, and counting it as a class made `today.css :: .biz .chip` read
   *  as a bleed onto a room that has no such element. */
  const SHELL_NAMES = ['page', 'h1', 'btn', 'primary', 'app', 'pill', 'good', 'warn', 'alert', 'indigo',
    'fx-cols-pop', 'fx-cols-opt', 'fx-cols-note']
  const mine = (n: string) => n.startsWith('rv-') || n.startsWith('is-') || n.startsWith('pg-') || SHELL_NAMES.includes(n)
  const roomNames = new Set<string>(['page', 'h1', 'btn', 'primary', 'app'])
  for (const m of SCREEN_CODE.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    for (const raw of (m[1] ?? m[2]).split(/[\s{}$?:'`]+/)) {
      const n = raw.trim()
      if (n && /^[a-zA-Z][\w-]*$/.test(n) && mine(n)) roomNames.add(n)
    }
  }
  for (const sel of selectorsOf(readFileSync(join(BIZ, 'business/reservations/reservations.css'), 'utf8'))) {
    for (const n of classesIn(sel)) if (mine(n)) roomNames.add(n)
  }

  const SIBLINGS = ['analytics', 'customers', 'inbox', 'karute', 'recording', 'register', 'settings', 'shifts', 'today']

  it('the room really does own the names it thinks it owns', () => {
    expect(roomNames.has('rv-row')).toBe(true)
    expect(roomNames.has('rv-insp')).toBe(true)
    expect(roomNames.has('pg-reservations')).toBe(true)
  })

  it('no sibling route sheet states a BARE rule that lands on this room', () => {
    const bleeds: string[] = []
    for (const room of SIBLINGS) {
      const css = readFileSync(join(BIZ, `business/${room}/${room}.css`), 'utf8')
      for (const sel of selectorsOf(css)) {
        if (!sel.startsWith('.biz') || sel.includes('.pg-') || sel.includes('.page-')) continue
        const names = classesIn(sel)
        if (names.length && names.every((n) => roomNames.has(n))) bleeds.push(`${room}.css :: ${sel}`)
      }
    }
    // ⚠ THE FOUR SHELL NAMES ARE THE EXPECTED SET, and this room states its own
    // value for each at FOUR levels (reservations.css's fence block), which is
    // one more than any sibling's three-level rule can tie.
    const room = readFileSync(join(BIZ, 'business/reservations/reservations.css'), 'utf8')
    for (const decl of [
      '.biz .page.pg-reservations { padding',
      '.biz .page.pg-reservations h1 {',
      '.biz .page.pg-reservations .btn {',
      '.biz .page.pg-reservations .btn.primary {',
    ]) {
      expect(room).toContain(decl)
    }
    const unfenced = bleeds.filter((b) => !/\.(btn|primary|page|pill|h1)\b/.test(b))
    expect(unfenced).toEqual([])
  })

  it('the parser sees the FIRST rule inside an @media block (red-proven)', () => {
    const planted = '@media (max-width: 900px){ .biz .rv-row { color: red } .biz .other { color: blue } }'
    expect(selectorsOf(planted)).toContain('.biz .rv-row')
  })
})

// ═══ ⚖ PAGE-SCROLL · the room's scroller census, from the sheet ════════════
describe('⚖ the page owns vertical scrolling', () => {
  const CSS = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/reservations/reservations.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')

  it('exactly ONE rule in this sheet caps a height or owns the vertical axis, and it is the sheet overlay', () => {
    const blocks = CSS.split('}').filter((b) => /max-height|overflow-y|overscroll-behavior/.test(b))
    const selectors = blocks.map((b) => b.slice(0, b.indexOf('{')).trim()).filter(Boolean)
    const offenders = selectors.filter((s) => !s.includes('.rv-sheet') && !s.includes('.rv-railcards') && !s.includes('.rv-seg'))
    expect(offenders).toEqual([])
    expect(selectors.some((s) => s.includes('.rv-sheet'))).toBe(true)
  })

  it('the two horizontal panners are the rail strip and the chip strip, and nothing else', () => {
    const blocks = CSS.split('}').filter((b) => /overflow-x\s*:\s*(auto|scroll)/.test(b))
    const selectors = blocks.map((b) => b.slice(0, b.indexOf('{')).trim())
    expect(selectors.every((s) => s.includes('.rv-railcards') || s.includes('.rv-seg'))).toBe(true)
    expect(selectors.length).toBeGreaterThanOrEqual(2)
  })

  it('the table card carries NO `overflow: hidden` — sticky dies under one', () => {
    const block = CSS.slice(CSS.indexOf('.biz .pg-reservations .rv-tablecard {'))
    expect(block.slice(0, block.indexOf('}'))).not.toContain('overflow')
  })

  it('the column head and the day headers hang off the MEASURED topbar, never a typed number', () => {
    // the .rv-thead rule itself, not just the token anywhere in the sheet — a
    // hardcoded 62px elsewhere (e.g. the phone .rv-dayhd override) must not
    // hide a typed number sneaking into THIS rule (M40)
    const thead = CSS.slice(CSS.indexOf('.biz .pg-reservations .rv-thead {'))
    expect(thead.slice(0, thead.indexOf('}'))).toContain('top: var(--rv-topbar);')
    expect(CSS).toContain('top: calc(var(--rv-topbar) + 26px)')
    expect(SCREEN_CODE).toContain("root.style.setProperty('--rv-topbar'")
    expect(SCREEN_CODE).toContain('new ResizeObserver(apply)')
  })
})


// ═══ THE TRUTHS THAT LIVE IN THE SHEET AND IN THE SHELL ════════════════════
//
// Some of this round's rules are CSS rules and one is the shell's own opt-in
// line. They are pinned HERE, from the source, because the mutation battery runs
// jest: a truth whose only guard is a browser probe has no NAMED killer, and a
// battery that can only report "the probe went red" is not discriminating.

describe('⚖ the sheet carries this round’s own laws', () => {
  const CSS = readFileSync(
    join(process.cwd(), 'src/app/[locale]/(business)/business/reservations/reservations.css'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '')
  const SHELL = readFileSync(join(process.cwd(), 'src/app/[locale]/(business)/business-shell.css'), 'utf8')

  it('⚖ ULTRA-WIDE · the 1416 cap is ONE token, and the reading column plus every card read it', () => {
    expect(CSS).toContain('--rv-maxw: 1416px')
    const view = CSS.slice(CSS.indexOf('.biz .pg-reservations .rv-view {'))
    expect(view.slice(0, view.indexOf('}'))).toContain('max-width: var(--rv-maxw)')
    const card = CSS.slice(CSS.indexOf('.biz .pg-reservations .rv-card {'))
    expect(card.slice(0, card.indexOf('}'))).toContain('max-width: var(--rv-maxw)')
  })

  it('⚖ F-R1 · the SHELL’s own `:has()` opt-in line names this room — the 1180px floor is lifted there, never here', () => {
    const line = SHELL.split('\n').find((l) => l.startsWith('.biz .app:has('))!
    expect(line).toContain('.page.pg-reservations')
    expect(line).toContain('min-width: 0')
    // …and the room does NOT reach up and lift its own floor
    expect(CSS).not.toContain('.app')
  })

  it('⚖-ADJ K · the rail becomes a strip from the SIXTH card, at every width', () => {
    expect(SCREEN_CODE).toContain('const railStrip = queue.length > 5')
    expect(SCREEN_CODE).toContain("`rv-railcards${railStrip ? ' is-strip' : ''}`")
    const strip = CSS.slice(CSS.indexOf('.biz .pg-reservations .rv-railcards.is-strip {'))
    expect(strip.slice(0, strip.indexOf('}'))).toContain('overflow-x: auto')
    // …and it is a FLEX line, never a second row of a grid
    expect(strip.slice(0, strip.indexOf('}'))).toContain('display: flex')
  })

  it('⚖-ADJ J · no `?freeze=` lever ships — a debug URL in product code is a dead lever waiting to be found', () => {
    expect(SCREEN_CODE).not.toContain('freeze')
    const props = readFileSync(
      join(process.cwd(), 'src/app/[locale]/(business)/business/reservations/reservations-props.ts'),
      'utf8',
    )
    expect(props).not.toContain('freeze')
    // the countdown's second hand is ONE interval from mount, and SSR renders 0
    expect(SCREEN_CODE).toContain('setInterval(() => setElapsedSec((s) => s + 1), 1000)')
    expect(SCREEN_CODE).toContain('useState(0)')
  })

  it('⚖-ADJ M · 期限超過 is derived ONCE, on the server’s pinned minute — there is no second overdue on the client', () => {
    const LIB = readFileSync(join(process.cwd(), 'src/business/lib/reservations.ts'), 'utf8')
    // exactly one place compares a deadline to the clock, and it is `decorate`
    expect([...SCREEN_CODE.matchAll(/deadlineMinute\s*<\s*boardNow/g)].length).toBe(1)
    // exactly one place COMPUTES the flag, and it is inside `decorate`
    expect([...SCREEN_CODE.matchAll(/(?:const|let|var)\s+overdue\s*=/g)].length).toBe(1)
    const decorateBody = SCREEN_CODE.slice(SCREEN_CODE.indexOf('export function decorate('))
    expect(decorateBody.slice(0, decorateBody.indexOf('\n}'))).toContain('const overdue =')
    // every other mention is a READ off a decorated row
    expect([...SCREEN_CODE.matchAll(/overdue\s*=[^=]/g)].length).toBe(1)
    // …and the countdown never feeds a state decision
    expect(SCREEN_CODE).not.toMatch(/elapsedSec[^)]*overdue/)
    expect(LIB).not.toContain('elapsedSec >')
  })

  it('⚖-ADJ B · `changeCommit` is KEPT, exported and unwired — the reconnect-shape of the send', () => {
    expect(SCREEN_CODE).toContain('export function changeCommit(')
    // nothing on the page calls it: the send refuses instead
    expect(SCREEN_CODE.split('changeCommit').length - 1).toBe(1)
    expect(SCREEN_CODE).toContain('setSendRefused(true)')
    expect(SCREEN_CODE).toContain('disabled={!picked || !pickReason}')
  })

  it('F-1 (fix round 1, LENS-2 BLOCKER) · 正本 has ONE home — genuineOf, read at both JSX sites, never re-spelled', () => {
    // the inspector's 正本 line USED TO spell the rule inline a second time
    // (the 記録 dialog's 正本・受付元 spelled it a first time, unpinned) — now
    // both call the one helper, so a future "fix" to either site alone cannot
    // ship with the suite green: there is nothing left to fix in two places.
    expect([...SCREEN_CODE.matchAll(/genuineOf\(/g)].length).toBeGreaterThanOrEqual(2)
    // …and the literal the helper alone is allowed to spell never appears at
    // a JSX site again — the mutant that re-inlines 'SYNQED' at either site
    // goes red here rather than surviving unpinned.
    expect(SCREEN_CODE).not.toMatch(/'SYNQED'/)
  })

  it('F-5 (fix round 1, LENS-4) · ONE escalate toast for both call sites — the rail card and the inspector agree', () => {
    // the rail card's own action used to add a clause the inspector's
    // `Primary` did not, for the identical non-write hand-off. One template
    // now, or a second spelling of the tail goes red here.
    expect([...SCREEN_CODE.matchAll(/渡すところまでを示します/g)].length).toBe(1)
    expect([...SCREEN_CODE.matchAll(/ESCALATE_TOAST\(row\.no\)/g)].length).toBe(2)
  })

  it('F-7 (fix round 1, LENS-3 F-2) · one scroll per action — the rail-card click and the inspector’s 変更 never double-scroll', () => {
    // toggleAtt takes the scroll TARGET now — 'row' (rail-card click,
    // unchanged) or 'rail' (the inspector) — so a caller can never fire both.
    expect(SCREEN_CODE).toContain("function toggleAtt(id: string, target: 'row' | 'rail' = 'row')")
    expect(SCREEN_CODE).toContain('if (target === \'row\') scrollToRow(id)')
    expect(SCREEN_CODE).toContain("else railRef.current?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })")
    expect(SCREEN_CODE).toContain("toggleAtt(r.id, 'row')")
    expect(SCREEN_CODE).toContain("toggleAtt(current.id, 'rail')")
    // …and the old second scroll the inspector used to fire right after
    // (`railRef.current?.scrollIntoView`) is gone — exactly one call per
    // branch, three in the whole file (scrollToRow's row scroll, the
    // toggleAtt rail scroll, the tour's own).
    expect([...SCREEN_CODE.matchAll(/scrollIntoView/g)].length).toBe(3)
    // the rail row is a scroll target now — it needs the same clearance off
    // the sticky topbar the sticky headers use, or its top edge lands under it.
    expect(CSS).toContain('scroll-margin-top: calc(var(--rv-topbar) + 10px)')
  })

  it('F-8 (fix round 1, LENS-3 F-3) · aria-controls names the tour panel only while it exists', () => {
    expect(SCREEN_CODE).toContain("aria-controls={tourOpen ? 'rvTour' : undefined}")
    expect(SCREEN_CODE).not.toContain('aria-controls="rvTour"')
  })

  it('F-6 (fix round 1, LENS-3 F-1 MUST-FIX) · the sheet declares itself a modal, and the trap/focus/scrim wiring exists in source', () => {
    expect(SCREEN_CODE).toContain('aria-modal="true"')
    expect(SCREEN_CODE).toContain('export function wireSheet(')
    expect(SCREEN_CODE).toContain('export function trapSheetTab(')
    expect(SCREEN_CODE).toContain(
      "export const SHEET_FOCUSABLE = 'button:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]'",
    )
    // wired the instant the panel mounts (useLayoutEffect, same timing as
    // RecordingScreen.tsx's Overlay)
    expect(SCREEN_CODE).toContain('return wireSheet(panel)')
    // the scrim's click is gated on the platform's own double-click interval
    expect(SCREEN_CODE).toContain('SCRIM_SETTLE_MS) closeSheet()')
    const LIB = readFileSync(join(process.cwd(), 'src/business/lib/reservations.ts'), 'utf8')
    expect(LIB).toContain('export const SCRIM_SETTLE_MS = 500')
    // close hands focus back to the row that opened it — the SAME focusResult
    // handoff every other commit on this page uses
    const closeSheetBody = SCREEN_CODE.slice(
      SCREEN_CODE.indexOf('function closeSheet() {'),
      SCREEN_CODE.indexOf('function toggleAtt('),
    )
    expect(closeSheetBody).toContain('focusResult(listRef.current, countRef.current, id)')
    // …and the opener row is captured where the sheet actually opens
    expect(SCREEN_CODE).toContain('sheetOpenerId.current = id')
  })

  it('F-6 · `wireSheet` drives real focus — opens onto the first focusable, Tab wraps at both ends', () => {
    // real DOM nodes, plain jsdom — the house pattern (mountPopover, above)
    document.body.innerHTML = ''
    const panel = document.createElement('aside')
    const grip = document.createElement('div')
    const close = document.createElement('button')
    close.textContent = '✕'
    const primary = document.createElement('button')
    primary.textContent = '受付リクエストを確認'
    const link = document.createElement('a')
    link.href = '/business/today'
    panel.append(grip, close, primary, link)
    document.body.append(panel)

    const cleanup = wireSheet(panel)
    // open — focus lands on the first FOCUSABLE (the grip carries no
    // button/link/select/textarea, so it is skipped)
    expect(document.activeElement).toBe(close)

    // Tab from the last focusable wraps to the first
    link.focus()
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(close)

    // Shift+Tab from the first wraps to the last
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(link)

    cleanup()
  })
})
