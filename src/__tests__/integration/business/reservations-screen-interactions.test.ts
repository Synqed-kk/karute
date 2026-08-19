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
import { toggleColumn, wireColumnsPopover } from '@/business/lib/column-config'
import {
  NEEDS_STAFF,
  WANTS_CHANGE,
  primaryActionOf,
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
    dayKey: 20260820,
    isToday: true,
    startMinute: 14 * 60 + 30,
    durationMinutes: 60,
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

// ─── 保存した表示 (chip selection) ─────────────────────────────────────────
describe('保存した表示 chips store CRITERIA, never a cached row set', () => {
  // canon `applySavedView` (w2-bookings-customers.js:734-745). Each chip sets
  // the four filters and the list re-derives; nothing caches which rows matched.
  it.each([
    ['all', { date: 'all', status: 'all', source: 'all', search: '' }],
    ['attention', { date: 'all', status: 'attention', source: 'all', search: '' }],
    ['reserve', { date: 'all', status: 'all', source: 'reserve', search: '' }],
    // 一致なし is canon's deliberate empty-result view: a saved view that
    // matches nothing has to be visibly survivable, not a state the screen hides.
    ['none', { date: 'all', status: 'all', source: 'all', search: '__一致なし__' }],
  ] as const)('「%s」 sets exactly canon\'s four filter values', (view, expected) => {
    expect(viewFilters(view)).toEqual(expected)
  })

  it('every chip lands on a DIFFERENT criteria set — no two views are the same view', () => {
    const seen = (['all', 'attention', 'reserve', 'none'] as const).map((v) => JSON.stringify(viewFilters(v)))
    expect(new Set(seen).size).toBe(4)
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
      b.className = 'booking-row'
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
