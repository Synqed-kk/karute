/**
 * @jest-environment jsdom
 *
 * 破棄の記録 — the redesigned screen (⚖ Liam 8/31, mock-approved).
 *
 * What changed is not decoration. The old row said WHEN a discard was written
 * and WHO wrote it; this one says which customer, which session, how long it
 * ran and where — the facts a manager actually needs to judge the sentence
 * beside them. So the properties worth pinning are the ones that make those
 * facts trustworthy:
 *
 *   · every fact is LABELLED — a bare 「4分12秒」 tells a reader nothing
 *   · every ABSENT fact renders as nothing, never as a zero or a guess
 *   · an absent NAME says WHICH kind of absence it is, never 顧客未選択 for all
 *   · 「同日」 is only ever said when it is true
 *   · a long transcript stays INSIDE its panel, marked every five minutes
 *   · the computer shows the whole reason NEXT TO the whole transcript
 *   · the composition is chosen by the SECTION's own measured width
 *
 * Asserted against the real ja.json copy, so a missing key fails here.
 */
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react'

function tFor(ns: string) {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return (key: string, vals?: Record<string, unknown>) => {
    let cur: unknown = ja
    for (const part of `${ns}.${key}`.split('.'))
      cur = (cur as Record<string, unknown> | undefined)?.[part]
    if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
    return cur.replace(/\{(\w+)\}/g, (_m, name: string) => String(vals?.[name] ?? `{${name}}`))
  }
}

jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => tFor(ns),
  useLocale: () => 'ja',
}))

const listDiscardReasons = jest.fn()
const getDiscardTranscript = jest.fn()
jest.mock('@/actions/recording-discards', () => ({
  listDiscardReasons: () => listDiscardReasons(),
  getDiscardTranscript: (id: string) => getDiscardTranscript(id),
}))

import { DiscardReasonsSection } from '@/components/settings/redesign/sections/DiscardReasonsSection'

const t = tFor('settings.discardReasons')
const tc = tFor('common')
const REASON = 'お客様との会話中に誤って録音を開始してしまいました'

/** Pinned as UTC INSTANTS, and every expectation below formats them the same
 *  way the component does rather than hard-coding a wall clock — so this file
 *  is correct in whatever zone it is run in. `jest.config.ts` sets no TZ, and
 *  the gate runs the discard suites in both UTC and Asia/Tokyo; the header used
 *  to state TZ=UTC as a fact, which was an assumption nothing enforced. The one
 *  place the zone genuinely matters is 「同日」, and the cases that prove it are
 *  built from LOCAL wall-clock parts for exactly that reason. */
const RECORDED_AT = '2026-08-31T05:28:00.000Z'
const DISCARDED_AT = '2026-08-31T05:33:00.000Z'

/** One short transcript, used wherever a test needs the words to actually be on
 *  screen. Module scope because both wide describes below read it. */
const WITH_WORDS = {
  ok: true,
  durationSeconds: 252,
  segments: [{ text: '本日はご来店ありがとうございます。', startTime: 4 }],
}

const BASE_ROW = {
  id: 'd1',
  recordingSessionId: 'rs-1',
  createdAt: DISCARDED_AT,
  staffId: 'staff-A',
  staffName: '原 奏恵',
  reason: REASON,
  customerId: 'cus-1',
  customerName: '田中 恵子',
  recordingCreatedAt: RECORDED_AT,
  durationSeconds: 252,
  storeName: '代官山店',
}

type Row = typeof BASE_ROW
type RowPatch = Partial<Record<keyof Row, unknown>>

const fmtDateTime = new Intl.DateTimeFormat('ja-JP', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const fmtTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' })

async function renderRows(
  patches: RowPatch[] = [{}],
  counts?: Record<string, unknown>,
  extra?: Record<string, unknown>,
) {
  listDiscardReasons.mockResolvedValue({
    ok: true,
    truncated: false,
    rows: patches.map((p, i) => ({ ...BASE_ROW, id: `d${i + 1}`, ...p })),
    counts: counts ?? { thisMonth: 1, total: 1, byStaff: [] },
    ...extra,
  })
  render(<DiscardReasonsSection />)
  // Wait on the FIRST row's own reason — a fixed string here would sit green
  // while a test that overrides the reason waited on text never rendered.
  const first = (patches[0]?.reason as string | undefined) ?? REASON
  await waitFor(() => screen.getAllByText(first))
}

/** THE WIDTH HARNESS. The section decides its composition from its OWN measured
 *  width, so driving that means answering the measurement — and jsdom has
 *  neither a layout nor a ResizeObserver. Both are stubbed, and the stub RECORDS
 *  what it was asked: a stub that answered `true` to any media query (which is
 *  what this file used to do) could not tell 1024px from 640px, so the
 *  breakpoint was structurally invisible and a build whose JS threshold had
 *  drifted off its CSS passed every test here.
 *
 *  The observer's callbacks are kept so a test can RESIZE. Subscription is a
 *  behaviour of its own: a rotated iPad, a dragged window and the settings
 *  shell's own drill-in all change this section's width without remounting it,
 *  and a build that measured once would freeze the composition at whatever
 *  width the tab happened to open at. */
const measured = { width: 0 }
const resizeCallbacks: (() => void)[] = []
const observedEls: Element[] = []

class StubResizeObserver {
  constructor(cb: () => void) {
    resizeCallbacks.push(cb)
  }
  observe(el: Element) {
    observedEls.push(el)
  }
  unobserve() {}
  disconnect() {}
}

/** Set the section's width BEFORE rendering. */
function setSectionWidth(px: number) {
  measured.width = px
}

/** …and after, the way a real resize arrives. */
async function resizeSectionTo(px: number) {
  measured.width = px
  await act(async () => {
    resizeCallbacks.forEach((cb) => cb())
  })
}

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value() {
      const w = measured.width
      return { width: w, height: 0, top: 0, left: 0, right: w, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }
    },
  })
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = StubResizeObserver
})

beforeEach(() => {
  jest.clearAllMocks()
  // Zero width is the "narrow" default the rest of this file reads.
  measured.width = 0
  resizeCallbacks.length = 0
  observedEls.length = 0
  getDiscardTranscript.mockResolvedValue({ ok: true, segments: [], durationSeconds: null })
})

describe('破棄の記録 — the row carries the recording, and labels every fact', () => {
  it('the customer leads the row', async () => {
    await renderRows()

    expect(screen.getByText('田中 恵子')).toBeInTheDocument()
  })

  it('the length is LABELLED — never a bare number a reader has to interpret', async () => {
    await renderRows()

    // 252s = 4分12秒, and the label says what those minutes ARE (⚖ the
    // self-explaining-numbers law: 録音10回 not 10回).
    expect(screen.getAllByText(t('durationLabel', { m: '4', s: '12' })).length).toBeGreaterThan(0)
    expect(t('durationLabel', { m: '4', s: '12' })).toContain('録音')
  })

  it('seconds are zero-padded and minutes are not — 0分38秒, not 0分38秒 vs 0分8秒', async () => {
    await renderRows([{ durationSeconds: 8 }])

    expect(screen.getByText(t('durationLabel', { m: '0', s: '08' }))).toBeInTheDocument()
  })

  it('the recording time and the store read together on the 録音 line', async () => {
    await renderRows()

    expect(
      screen.getByText(t('recordedAt', { when: fmtDateTime.format(new Date(RECORDED_AT)) }), {
        exact: false,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('代官山店', { exact: false })).toBeInTheDocument()
  })

  it('the reason is labelled AND whole — never an excerpt on the phone', async () => {
    const long = `${REASON}${'。次回からは開始前に必ず確認します'.repeat(6)}`
    await renderRows([{ reason: long }])

    expect(screen.getByText(t('reasonLabel'))).toBeInTheDocument()
    expect(screen.getByText(long)).toBeInTheDocument()
  })
})

describe('破棄の記録 — an absent fact renders as nothing, never as a guess', () => {
  it('no customer: the honest 顧客未選択, not a blank and not an invented name', async () => {
    await renderRows([{ customerId: null, customerName: null }])

    expect(screen.getByText(t('customerNone'))).toBeInTheDocument()
  })

  it('no length: NO pill at all — 0分00秒 would be a claim about the recording', async () => {
    await renderRows([{ durationSeconds: null }])

    expect(screen.queryByText(/録音 \d+分/)).toBeNull()
    // …and the row itself is untouched.
    expect(screen.getByText(REASON)).toBeInTheDocument()
  })

  /** The 録音 label with nothing after it. Asserted POSITIVELY, because ruling
   *  out "Invalid Date" and "NaN" left an unfilled `{when}` — or a bare
   *  「録音 」 with an empty run where a date belongs — perfectly green, which
   *  is the "absence is never a placeholder" law read backwards. The length
   *  pill carries 録音 too, so these fixtures drop it to keep the query about
   *  the one line under test. The trailing space is load-bearing: the section's
   *  own description opens with 「録音を破棄した…」, and a bare 録音 would match
   *  that instead of the line being asserted about. */
  const recordedMarker = new RegExp(t('recordedAt', { when: '' }))

  it('no recording time: the 録音 line is DROPPED, not printed with an empty slot', async () => {
    await renderRows([{ recordingCreatedAt: null, durationSeconds: null }])

    expect(screen.queryByText(recordedMarker)).toBeNull()
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.queryByText(/NaN/)).toBeNull()
    expect(screen.getByText(REASON)).toBeInTheDocument()
  })

  it('an UNPARSEABLE timestamp is an absence too — Intl.format on it THROWS', async () => {
    // Not a rendering nicety: `Intl.DateTimeFormat.prototype.format` on an
    // Invalid Date raises RangeError rather than printing "Invalid Date", so
    // one bad string anywhere in the ledger replaced the whole screen with an
    // error card. `z.string()` at the door accepts any string, including one no
    // clock can read, and the WEB door has no parse at all.
    await renderRows([
      { recordingCreatedAt: 'いつだったか', createdAt: 'いつだったか', durationSeconds: null },
    ])

    expect(screen.getByText(REASON)).toBeInTheDocument()
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.getByText(t('discardedAt', { when: t('unknownValue') }), { exact: false }))
      .toBeInTheDocument()
  })

  it('no store: the 録音 line still states the time, without inventing a place', async () => {
    await renderRows([{ storeName: null }])

    expect(
      screen.getByText(t('recordedAt', { when: fmtDateTime.format(new Date(RECORDED_AT)) })),
    ).toBeInTheDocument()
    expect(screen.queryByText('代官山店', { exact: false })).toBeNull()
  })

  it('a server OLDER than this build sends the fields absent — and nothing reads NaN', async () => {
    // The row fields are not re-typed at the thin port, so an older deployment
    // answers with the keys missing rather than null. `=== null` does not catch
    // `undefined`, and the formatter would have put 「録音 NaN分NaN秒」 on a
    // manager's screen — a number that is worse than no number.
    await renderRows([
      {
        customerName: undefined,
        customerId: undefined,
        recordingCreatedAt: undefined,
        durationSeconds: undefined,
        storeName: undefined,
      },
    ])

    expect(screen.queryByText(/NaN/)).toBeNull()
    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.queryByText(recordedMarker)).toBeNull()
    // …and it says 不明, NOT 顧客未選択. This is the case where the screen knows
    // the LEAST — an old wire told us nothing about the recording — and it used
    // to be the case where it claimed the most.
    expect(screen.getByText(t('unknownValue'))).toBeInTheDocument()
    expect(screen.queryByText(t('customerNone'))).toBeNull()
    expect(screen.getByText(REASON)).toBeInTheDocument()
  })

  it('a malformed length is refused too — a string is not a number of seconds', async () => {
    await renderRows([{ durationSeconds: '252' }])

    expect(screen.queryByText(/NaN/)).toBeNull()
    expect(screen.queryByText(/録音 \d+分/)).toBeNull()
  })

  it('an unknown staff member still names the discard honestly', async () => {
    await renderRows([{ staffName: null }])

    expect(screen.getByText(t('unknownStaff'))).toBeInTheDocument()
  })
})

// ⚖ B1. 「顧客未選択」 is a sentence about what a STAFFER did — "no customer was
// selected" — and three genuinely different populations used to print it on the
// one screen whose job is checking a staffer's claim. A manager reading eight
// such rows concludes the staffer keeps recording without attaching a customer;
// six of those rows may be sessions whose recordings merely fell outside our own
// read window. Compare the staff field, which has always got this right:
// unresolvable staff read 担当者不明 (unknown), never 担当者なし (there was none).
describe('破棄の記録 — an absent NAME says WHICH kind of absence it is', () => {
  it('the recording read fine and carried no customer: 顧客未選択, the genuine state', async () => {
    await renderRows([{ customerId: null, customerName: null }])

    expect(screen.getByText(t('customerNone'))).toBeInTheDocument()
    expect(screen.queryByText(t('customerNameUnknown'))).toBeNull()
  })

  it('the recording was never read: 不明 — nothing can be said about its customer', async () => {
    await renderRows([{ customerId: null, customerName: null, recordingCreatedAt: null }])

    expect(screen.getByText(t('unknownValue'))).toBeInTheDocument()
    expect(screen.queryByText(t('customerNone'))).toBeNull()
  })

  it('a customer WAS attached and only the NAME failed: 顧客名不明', async () => {
    // The sharpest of the three, and the one nothing covered. The row is still
    // CARRYING the id — positive evidence a customer was attached — and the
    // server keeps that split deliberately ("keeps its ID and loses only the
    // name"). The screen used to throw it away at the last step.
    await renderRows([{ customerId: 'cus-1', customerName: null }])

    expect(screen.getByText(t('customerNameUnknown'))).toBeInTheDocument()
    expect(screen.queryByText(t('customerNone'))).toBeNull()
  })

  it('a BLANK name is not a name — it takes the same honest answer', async () => {
    await renderRows([{ customerId: 'cus-1', customerName: '   ' }])

    expect(screen.getByText(t('customerNameUnknown'))).toBeInTheDocument()
  })

  it('a supplementary-plane surname keeps its own character on the avatar', async () => {
    // 𠮷 (as in 𠮷田), 𡈽 and 𠀋 are surrogate pairs and appear in real family
    // registers, so `name[0]` handed the avatar a lone high surrogate and drew
    // a replacement glyph beside a correctly rendered name — a customer seeing
    // their own name broken on the manager's screen.
    await renderRows([{ customerName: '𠮷田 花子' }])

    expect(screen.getByText('𠮷')).toBeInTheDocument()
  })
})

describe('破棄の記録 — 「同日」 is only ever said when it is true', () => {
  it('discarded the same day: the short form, with the time', async () => {
    await renderRows()

    expect(
      screen.getByText(
        t('discardedAt', {
          when: `${t('sameDay')} ${fmtTime.format(new Date(DISCARDED_AT))}`,
        }),
        { exact: false },
      ),
    ).toBeInTheDocument()
  })

  it('discarded the NEXT day: the full date — 同日 would be a lie', async () => {
    // The overnight case this exists for: a take left running is cleaned up the
    // following morning.
    const nextDay = '2026-09-01T01:10:00.000Z'
    await renderRows([{ createdAt: nextDay }])

    expect(screen.queryByText(new RegExp(t('sameDay')))).toBeNull()
    expect(
      screen.getByText(t('discardedAt', { when: fmtDateTime.format(new Date(nextDay)) }), {
        exact: false,
      }),
    ).toBeInTheDocument()
  })

  it('no recording time to compare against: the full date, never a guessed 同日', async () => {
    await renderRows([{ recordingCreatedAt: null }])

    expect(screen.queryByText(new RegExp(t('sameDay')))).toBeNull()
  })

  // THE ZONE. 「同日」 is decided on the viewer's CALENDAR day, because the dates
  // printed beside it come from Intl in that same zone — but every fixture above
  // is same-day and cross-day in UTC and JST alike, so a UTC-day implementation
  // was indistinguishable from a correct one and a mutation proved it. These two
  // are built from LOCAL wall-clock parts: in a runtime offset from UTC (the
  // Asia/Tokyo half of the gate, and every real viewer) they straddle a UTC
  // midnight while staying on one local day, and vice versa.
  it('two instants on the same LOCAL day are 同日, however UTC divides them', async () => {
    const rec = new Date(2026, 7, 31, 0, 30)
    const disc = new Date(2026, 7, 31, 23, 30)
    await renderRows([{ recordingCreatedAt: rec.toISOString(), createdAt: disc.toISOString() }])

    expect(
      screen.getByText(
        t('discardedAt', { when: `${t('sameDay')} ${fmtTime.format(disc)}` }),
        { exact: false },
      ),
    ).toBeInTheDocument()
  })

  it('…and two LOCAL days are never 同日, however UTC joins them', async () => {
    // The nightly-shift salon's ordinary case: a take recorded before midnight
    // and cleaned up after it. A UTC-day implementation prints 「破棄 同日 01:00」
    // directly under a 録音 line reading the previous date — the screen
    // contradicting itself on the one fact a manager is trying to establish.
    const rec = new Date(2026, 7, 31, 23, 30)
    const disc = new Date(2026, 8, 1, 0, 30)
    await renderRows([{ recordingCreatedAt: rec.toISOString(), createdAt: disc.toISOString() }])

    expect(screen.queryByText(new RegExp(t('sameDay')))).toBeNull()
  })
})

describe('破棄の記録 — the summary band states labelled facts', () => {
  it('this month and the running total, each saying what it counts', async () => {
    await renderRows([{}], {
      thisMonth: 6,
      total: 24,
      byStaff: [{ staffId: 'staff-A', staffName: '原 奏恵', thisMonth: 3 }],
    })

    expect(screen.getByText(t('countThisMonth', { count: 6 }))).toBeInTheDocument()
    expect(screen.getByText(t('countTotal', { count: 24 }))).toBeInTheDocument()
    expect(screen.getByText(t('byStaffTitle'))).toBeInTheDocument()
    expect(screen.getByText(t('byStaffItem', { name: '原 奏恵', count: 3 }))).toBeInTheDocument()
  })

  it('a staffer whose name is unknown still appears with their count', async () => {
    await renderRows([{}], {
      thisMonth: 1,
      total: 1,
      byStaff: [{ staffId: 'ghost', staffName: null, thisMonth: 1 }],
    })

    expect(
      screen.getByText(t('byStaffItem', { name: t('unknownStaff'), count: 1 })),
    ).toBeInTheDocument()
  })

  it('partial enrichment says so ONCE, in the same quiet register as the list', async () => {
    // Past the recordings budget some listed rows carry absences that are ours,
    // beside complete neighbours. `truncated` covers only the discard ledger,
    // so the screen used to say nothing at all — which a manager reads as a
    // system fault rather than a boundary.
    await renderRows([{}], undefined, { detailTruncated: true })

    expect(screen.getAllByText(t('detailTruncated'))).toHaveLength(1)
  })

  it('a fully enriched read carries no such line (control)', async () => {
    await renderRows([{}], undefined, { detailTruncated: false })

    expect(screen.queryByText(t('detailTruncated'))).toBeNull()
  })
})

describe('破棄の記録 — a long transcript stays inside its panel', () => {
  const LONG = {
    ok: true,
    durationSeconds: 2838,
    segments: [
      { text: '本日はよろしくお願いいたします。', startTime: 4 },
      { text: 'このあたり、少し固くなっていますね。', startTime: 266 },
      { text: 'やっぱりそうですか。', startTime: 348 },
      { text: 'なるほど、休憩のときにやってみます。', startTime: 555 },
      { text: '少しずつ緩んできましたね。', startTime: 662 },
    ],
  }

  async function openLong(payload: unknown = LONG) {
    getDiscardTranscript.mockResolvedValue(payload)
    await renderRows()
    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptShow')))
    })
  }

  it('every line carries its own m:ss clock', async () => {
    await openLong()

    expect(screen.getByText('0:04')).toBeInTheDocument()
    expect(screen.getByText('4:26')).toBeInTheDocument()
    expect(screen.getByText('11:02')).toBeInTheDocument()
  })

  it('a marker appears only where the words CROSS a five-minute boundary', async () => {
    await openLong()

    // 4:26 → 5:48 crosses 5分; 9:15 → 11:02 crosses 10分. 5:48 → 9:15 stays
    // inside the same five minutes and gets nothing — a marker there would
    // announce a boundary the recording never passed.
    expect(screen.getByText(t('transcriptMinutes', { n: 5 }))).toBeInTheDocument()
    expect(screen.getByText(t('transcriptMinutes', { n: 10 }))).toBeInTheDocument()
    expect(screen.queryByText(t('transcriptMinutes', { n: 15 }))).toBeNull()
    expect(screen.queryByText(t('transcriptMinutes', { n: 0 }))).toBeNull()
  })

  it('a segment landing EXACTLY on the boundary has crossed it', async () => {
    // The one value the constant names, and no fixture had ever landed on it.
    await openLong({
      ok: true,
      durationSeconds: 700,
      segments: [
        { text: '直前です。', startTime: 299 },
        { text: 'ちょうどです。', startTime: 300 },
      ],
    })

    expect(screen.getByText(t('transcriptMinutes', { n: 5 }))).toBeInTheDocument()
  })

  it('a jump over several boundaries names the LAST one crossed, not the first', async () => {
    // A gap in the words — a silence, a pause, a stretch nothing was kept from
    // — skips 5分 and 10分 and lands past 15分. Naming the boundary just crossed
    // is right, because the marker tells a reader WHERE THEY ARE; a prev-based
    // implementation would say 5分 and render identically against every other
    // fixture in this file.
    await openLong({
      ok: true,
      durationSeconds: 1200,
      segments: [
        { text: 'はじめのほう。', startTime: 100 },
        { text: 'だいぶあと。', startTime: 1000 },
      ],
    })

    expect(screen.getByText(t('transcriptMinutes', { n: 15 }))).toBeInTheDocument()
    expect(screen.queryByText(t('transcriptMinutes', { n: 5 }))).toBeNull()
    expect(screen.queryByText(t('transcriptMinutes', { n: 10 }))).toBeNull()
  })

  it('the panel header states the length beside the words', async () => {
    await openLong()

    expect(screen.getByText(t('transcriptTitle'))).toBeInTheDocument()
    // 2838s = 47分18秒 — the same labelled length the row's own pill states.
    expect(screen.getAllByText(t('durationLabel', { m: '47', s: '18' })).length).toBeGreaterThan(0)
  })

  it('the words scroll INSIDE the panel — the row never grows with the recording', async () => {
    const { container } = { container: document.body }
    await openLong()

    const scroller = container.querySelector('.overflow-y-auto')
    expect(scroller).not.toBeNull()
    // Bounded and self-contained: an unbounded panel would push a 47-minute
    // transcript down the settings page, which is the ⚖ 8/31 complaint itself.
    expect(scroller?.className).toMatch(/max-h-\[\d+px\]/)
    expect(scroller?.className).toContain('overscroll-contain')
  })

  it('no clocks on the wire: the words still read, with NO markers invented', async () => {
    // An older deployment answers without startTime — the thin port normalises
    // it to null, and the panel must then place nothing rather than compute
    // boundaries from a value it does not have.
    await openLong({
      ok: true,
      durationSeconds: 2838,
      segments: [
        { text: '本日はよろしくお願いいたします。', startTime: null },
        { text: 'このあたり、少し固くなっていますね。', startTime: null },
        { text: 'やっぱりそうですか。', startTime: null },
      ],
    })

    expect(screen.getByText('本日はよろしくお願いいたします。')).toBeInTheDocument()
    expect(screen.getByText('やっぱりそうですか。')).toBeInTheDocument()
    expect(screen.queryByText(t('transcriptMinutes', { n: 5 }))).toBeNull()
    expect(screen.queryByText('0:04')).toBeNull()
  })
})

describe('破棄の記録 — the computer reads the claim NEXT TO the evidence', () => {
  it('the newest row opens on arrival — a detail pane with no selection shows nothing', async () => {
    setSectionWidth(1200)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows([{}, { id: 'd2', reason: 'ふたつめ' }])

    await waitFor(() => expect(getDiscardTranscript).toHaveBeenCalledWith('rs-1'))
    expect(screen.getByText(t('defRecordedAt'))).toBeInTheDocument()
    // ONCE. `toHaveBeenCalledWith` is satisfied by one call or by five hundred,
    // and the effect depends on the resolved selection while `openRow` sets the
    // state that recomputes it — the guard is the only thing between this and a
    // fetch loop hammering core once per render, with the assertion above still
    // green. The sibling suite already uses this idiom for the same class.
    expect(getDiscardTranscript).toHaveBeenCalledTimes(1)
  })

  it('the whole reason and the whole transcript are both on screen at once (⚖ 8/25 A)', async () => {
    setSectionWidth(1200)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows()

    await waitFor(() => screen.getByText('本日はご来店ありがとうございます。'))
    // The left column excerpts the reason with CSS and the detail pane carries
    // it whole — so the full sentence is present, beside the words it is a
    // claim about.
    expect(screen.getAllByText(REASON).length).toBeGreaterThan(0)
    expect(screen.getByText(t('transcriptTitle'))).toBeInTheDocument()
  })

  it('the four facts about the take get named columns', async () => {
    setSectionWidth(1200)
    await renderRows()

    await waitFor(() => screen.getByText(t('defRecordedAt')))
    expect(screen.getByText(t('defDuration'))).toBeInTheDocument()
    expect(screen.getByText(t('defStore'))).toBeInTheDocument()
    expect(screen.getByText(t('defDiscarded'))).toBeInTheDocument()
  })

  it('an unreadable fact reads 不明 in the definition row — a gap would misalign the grid', async () => {
    setSectionWidth(1200)
    await renderRows([{ storeName: null, durationSeconds: null, recordingCreatedAt: null }])

    await waitFor(() => screen.getByText(t('defStore')))
    // Three columns cannot be answered; 不明 is a statement about our knowledge,
    // not about the recording.
    expect(screen.getAllByText(t('unknownValue'))).toHaveLength(3)
  })

  it('pressing another row moves the selection — and never empties the pane', async () => {
    setSectionWidth(1200)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows([{}, { id: 'd2', recordingSessionId: 'rs-2', reason: 'ふたつめの理由' }])

    await waitFor(() => screen.getByText(t('defRecordedAt')))
    const list = document.querySelector('ul')
    const second = within(list as HTMLElement).getByText('ふたつめの理由')
    await act(async () => {
      fireEvent.click(second)
    })

    expect(getDiscardTranscript).toHaveBeenCalledWith('rs-2')
    // Pressing it AGAIN must not close it: a pane that can be emptied by its
    // own row is just a way to make the screen show less.
    await act(async () => {
      fireEvent.click(second)
    })
    expect(screen.getByText(t('defRecordedAt'))).toBeInTheDocument()
  })

  it('the selected row is marked with the accent, never a dark fill (R13)', async () => {
    setSectionWidth(1200)
    await renderRows()

    await waitFor(() => screen.getByText(t('defRecordedAt')))
    const selected = document.querySelector('[aria-current="true"]')
    expect(selected).not.toBeNull()
    expect(selected?.className).toContain('bg-primary/8')
    expect(selected?.className).toContain('border-primary')
  })

  it('the definition cell states the length WITHOUT repeating its own label', async () => {
    // 録音時間 over 「録音 47分18秒」 is the label said twice; in English it read
    // "Length / Recording 47m 18s". The pill and the panel header keep the
    // prefix, where it is doing work.
    setSectionWidth(1200)
    await renderRows()

    await waitFor(() => screen.getByText(t('defDuration')))
    expect(screen.getByText(t('durationValue', { m: '4', s: '12' }))).toBeInTheDocument()
    expect(t('durationValue', { m: '4', s: '12' })).not.toContain('録音')
  })

  it('a failed transcript read is NAMED and RECOVERABLE on the computer', async () => {
    // The failed row is already selected, so pressing it again looks like a
    // no-op — the one gesture that would retry is the one a manager has no
    // reason to try, and their only exit was to select another discard and come
    // back. A sentence that will not move reads as "the words are gone", which
    // is the conclusion this screen's absence doctrine exists to prevent.
    setSectionWidth(1200)
    getDiscardTranscript.mockRejectedValueOnce(new Error('offline'))
    await renderRows()

    await waitFor(() => screen.getByText(t('transcriptFailed')))
    // …and the card carries its name, so a bordered box of grey text beside a
    // labelled 理由 card is not an anonymous one (⚖ 8/25 A, two EQUAL cards).
    expect(screen.getByText(t('transcriptTitle'))).toBeInTheDocument()

    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await act(async () => {
      fireEvent.click(screen.getByText(tc('retry')))
    })

    expect(screen.getByText('本日はご来店ありがとうございます。')).toBeInTheDocument()
    expect(screen.queryByText(t('transcriptFailed'))).toBeNull()
  })

  it('selecting another discard REMOUNTS the transcript panel', async () => {
    // Reconciled in place, the scroll container is the SAME DOM node across
    // selections and the browser keeps its scrollTop: a manager who scrolled to
    // minute 40 of a 90-minute take and then clicked the next row opened it
    // already scrolled into the middle, with the sticky header not moving and
    // nothing on screen saying they were not at the start. The phone door never
    // had this — each panel mounts inside its own row.
    setSectionWidth(1200)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows([{}, { id: 'd2', recordingSessionId: 'rs-2', reason: 'ふたつめの理由' }])

    await waitFor(() => screen.getByText('本日はご来店ありがとうございます。'))
    const before = document.querySelector('[role="region"]')
    expect(before).not.toBeNull()

    const list = document.querySelector('ul')
    await act(async () => {
      fireEvent.click(within(list as HTMLElement).getByText('ふたつめの理由'))
    })
    await waitFor(() => screen.getByText('本日はご来店ありがとうございます。'))

    const after = document.querySelector('[role="region"]')
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
  })

  it('the transcript scroller is reachable and named for a keyboard', async () => {
    // Safari and WKWebView — the two engines this product ships through — do
    // not make an overflow container focusable on their own, so a keyboard-only
    // manager could open the longest discard on the list and then move it by
    // exactly nothing.
    setSectionWidth(1200)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows()

    await waitFor(() => screen.getByText('本日はご来店ありがとうございます。'))
    const region = document.querySelector('[role="region"]')
    expect(region?.getAttribute('tabindex')).toBe('0')
    expect(region?.getAttribute('aria-label')).toBe(t('transcriptTitle'))
  })
})

// ⚖ B2. Every threshold in this component used to read the VIEWPORT, while the
// surface it paints on is capped at ~928px by the settings chrome — a 244px
// sidebar, then max-w-5xl, then two nested p-6. So master–detail switched on at
// a section width of 684px, where ⚖ 8/25's "two equal cards" are 160px each:
// about six Japanese glyphs per line of transcript, and strictly worse than the
// inline composition one pixel earlier.
describe('破棄の記録 — the composition is decided by the SECTION, not the window', () => {
  it('below 880px of section width the inline composition holds', async () => {
    setSectionWidth(879)
    await renderRows()

    expect(screen.queryByText(t('defRecordedAt'))).toBeNull()
    expect(screen.getByText(t('transcriptShow'))).toBeInTheDocument()
  })

  it('at 880px the master–detail composition takes over', async () => {
    setSectionWidth(880)
    await renderRows()

    await waitFor(() => screen.getByText(t('defRecordedAt')))
    expect(screen.queryByText(t('transcriptShow'))).toBeNull()
  })

  it('it SUBSCRIBES: a resize re-decides, it is not measured once at mount', async () => {
    // A rotated iPad, a dragged desktop window and the settings shell's own
    // drill-in all change this width without remounting the section.
    setSectionWidth(600)
    await renderRows()
    expect(screen.queryByText(t('defRecordedAt'))).toBeNull()
    expect(observedEls.length).toBeGreaterThan(0)

    await resizeSectionTo(1200)

    expect(screen.getByText(t('defRecordedAt'))).toBeInTheDocument()
  })

  it('crossing back to the inline door drops the selection nobody asked for', async () => {
    // The wide pane opens the newest row by itself, because an empty pane shows
    // nothing. `openId` used to survive the switch, so an iPad rotated out of
    // landscape landed on the inline list with a customer's transcript sitting
    // open — the exact state this file's own doctrine forbids on that door.
    setSectionWidth(1200)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows()
    await waitFor(() => screen.getByText('本日はご来店ありがとうございます。'))

    await resizeSectionTo(600)

    expect(screen.queryByText('本日はご来店ありがとうございます。')).toBeNull()
    expect(screen.getByText(t('transcriptShow'))).toBeInTheDocument()
  })

  it('a row the MANAGER pressed stays open across the same crossing', async () => {
    setSectionWidth(600)
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows()
    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptShow')))
    })
    expect(screen.getByText('本日はご来店ありがとうございます。')).toBeInTheDocument()

    await resizeSectionTo(700)

    expect(screen.getByText('本日はご来店ありがとうございます。')).toBeInTheDocument()
  })

  it('four definition columns wait until the PANE can hold four', async () => {
    // Keyed to `xl` this fired at a viewport of 1280, where the chrome leaves
    // the pane 518px and four columns are 114px each — 「8月31日(月) 14:28」
    // wrapping to three lines in every one of them, which is the exact squeeze
    // the old comment claimed to have prevented.
    setSectionWidth(1000)
    await renderRows()
    await waitFor(() => screen.getByText(t('defRecordedAt')))
    expect(document.querySelector('dl')?.className).toContain('grid-cols-2')

    await resizeSectionTo(1400)

    expect(document.querySelector('dl')?.className).toContain('grid-cols-4')
  })
})

describe('破棄の記録 — the heading is not said twice', () => {
  it('the section title is hidden where the settings shell already renders it', async () => {
    // The drill-in shell titles the section below `md`; above it, only a tab
    // chip. Rendering the h2 unconditionally is what produced the triple stack
    // Liam read in the field.
    await renderRows()

    const heading = screen.getByRole('heading', { name: t('title'), hidden: true })
    expect(heading.className).toContain('hidden')
    expect(heading.className).toContain('md:block')
  })
})
