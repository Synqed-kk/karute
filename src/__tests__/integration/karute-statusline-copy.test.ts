/**
 * karute.recordList.statusLine content pin (karute-tab restructure PR-1b
 * 正直ヘッダー). The original line — 「今月のカルテ · {monthCount} · 過去
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
      'カルテ 今月 {monthCount}件 ・ 表示中 {showingCount}件',
    )
  })

  it('en.json matches the adjudicated string exactly', () => {
    expect(en.karute.recordList.statusLine).toBe(
      'This month: {monthCount} karute · showing {showingCount}',
    )
  })

  it('neither locale ships the disproven "past 14 days" window, in the statusLine or anywhere else in the recordList namespace', () => {
    const jaFlat = JSON.stringify(ja.karute.recordList)
    const enFlat = JSON.stringify(en.karute.recordList)
    expect(jaFlat).not.toContain('過去14日間')
    expect(enFlat.toLowerCase()).not.toContain('14 days')
  })
})
