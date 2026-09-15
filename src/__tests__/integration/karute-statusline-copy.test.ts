/**
 * karute.recordList.statusLine content pin (karute-tab restructure PR-1b
 * 正直ヘッダー, extended to v2 by PR-2a 日付チャンク読み込み — 全{total}件
 * joins the line now that chunk loading makes the whole store browsable;
 * PR-1b held it back on purpose while only 200 rows could ever load). The original line — 「今月のカルテ · {monthCount} · 過去
 * 14日間 · {showingCount}件を表示中」 / "This month {monthCount} karute ·
 * past 14 days · showing {showingCount}" — named a window ("past 14 days")
 * nothing in the query actually enforced (ja.json:1358 was unbacked copy,
 * per the adversarial-round packet). Byte-exact pin so a future edit can't
 * silently reintroduce the disproven window.
 */
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

describe('karute.recordList.statusLine states only what the query backs (PR-1b 正直ヘッダー)', () => {
  it('ja.json matches the adjudicated string exactly', () => {
    expect(ja.karute.recordList.statusLine).toBe(
      'カルテ 全{total}件 ・ 今月 {monthCount}件 ・ 表示中 {showingCount}件',
    )
  })

  it('en.json matches the adjudicated string exactly', () => {
    expect(en.karute.recordList.statusLine).toBe(
      'Karute · {total} total · {monthCount} this month · showing {showingCount}',
    )
  })

  it('statusLineDiscarded / statusLineNoMonthDiscarded match the R1 repair (2026-09-13, F1)', () => {
    // 全 now names the SAME universe 表示中 counts under すべて (active +
    // discarded) — see the Business sibling this mirrors,
    // business/karute.test.ts:405's monthLabel 「カルテ 今月 N件（うち破棄
    // M件）」, quoted in BUILD-REPORT-ANTHONY-REPAIRS-2026-09-13.md.
    expect(ja.karute.recordList.statusLineDiscarded).toBe(
      'カルテ 全{total}件（うち破棄{discarded}件）・ 今月 {monthCount}件 ・ 表示中 {showingCount}件',
    )
    expect(ja.karute.recordList.statusLineNoMonthDiscarded).toBe(
      'カルテ 全{total}件（うち破棄{discarded}件）・ 表示中 {showingCount}件',
    )
    expect(en.karute.recordList.statusLineDiscarded).toBe(
      'Karute · {total} total ({discarded} discarded) · {monthCount} this month · showing {showingCount}',
    )
    expect(en.karute.recordList.statusLineNoMonthDiscarded).toBe(
      'Karute · {total} total ({discarded} discarded) · showing {showingCount}',
    )
  })

  it('the さらに表示 label + append announcement are pinned in both locales (PR-2a)', () => {
    expect(ja.karute.recordList.loadMore).toBe('さらに表示（{date}以前のカルテ）')
    expect(ja.karute.recordList.addedCount).toBe('{n}件を読み込みました')
    expect(en.karute.recordList.loadMore).toBe('Show more (karute before {date})')
    expect(en.karute.recordList.addedCount).toBe('Loaded {n} karute')
  })

  it('the 月ジャンプ panel copy is the MOCK\'s, byte-for-byte (PR-2b)', () => {
    // Liam approved these two strings as drawn — they ship verbatim, so an
    // edit has to come through this pin rather than slide past it.
    expect(ja.karute.recordList.month.panelTitle).toBe('月を選択')
    expect(ja.karute.recordList.month.note).toBe(
      '月を選ぶと、その月のカルテに絞り込まれます。',
    )
    expect(en.karute.recordList.month.panelTitle).toBe('Select a month')
    expect(en.karute.recordList.month.note).toBe(
      "Pick a month to narrow the list to that month's karute.",
    )
  })

  it('neither locale ships the disproven "past 14 days" window, in the statusLine or anywhere else in the recordList namespace', () => {
    const jaFlat = JSON.stringify(ja.karute.recordList)
    const enFlat = JSON.stringify(en.karute.recordList)
    expect(jaFlat).not.toContain('過去14日間')
    expect(enFlat.toLowerCase()).not.toContain('14 days')
  })
})
