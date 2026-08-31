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
 *   · 「同日」 is only ever said when it is true
 *   · a long transcript stays INSIDE its panel, marked every five minutes
 *   · the computer shows the whole reason NEXT TO the whole transcript
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
const REASON = 'お客様との会話中に誤って録音を開始してしまいました'

/** JST 14:28 and 14:33 — the suites run at TZ=UTC, so these are pinned as UTC
 *  instants and every expectation below formats them the same way the component
 *  does rather than hard-coding a wall clock. */
const RECORDED_AT = '2026-08-31T05:28:00.000Z'
const DISCARDED_AT = '2026-08-31T05:33:00.000Z'

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

async function renderRows(patches: RowPatch[] = [{}], counts?: Record<string, unknown>) {
  listDiscardReasons.mockResolvedValue({
    ok: true,
    truncated: false,
    rows: patches.map((p, i) => ({ ...BASE_ROW, id: `d${i + 1}`, ...p })),
    counts: counts ?? { thisMonth: 1, total: 1, byStaff: [] },
  })
  render(<DiscardReasonsSection />)
  // Wait on the FIRST row's own reason — a fixed string here would sit green
  // while a test that overrides the reason waited on text never rendered.
  const first = (patches[0]?.reason as string | undefined) ?? REASON
  await waitFor(() => screen.getAllByText(first))
}

/** The wide composition. matchMedia is absent in jsdom, so the component starts
 *  narrow by design — defining it here is what puts the master–detail pane on
 *  screen, and its absence everywhere else is what keeps the phone shape the
 *  default the rest of this file reads. */
function useWideViewport() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  // @ts-expect-error — removing the property is the "narrow" default.
  delete window.matchMedia
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

  it('no recording time: the 録音 line is dropped, never printed as Invalid Date', async () => {
    await renderRows([{ recordingCreatedAt: null }])

    expect(screen.queryByText(/Invalid Date/)).toBeNull()
    expect(screen.queryByText(/NaN/)).toBeNull()
    expect(screen.getByText(REASON)).toBeInTheDocument()
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
    expect(screen.getByText(t('customerNone'))).toBeInTheDocument()
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
  const WITH_WORDS = {
    ok: true,
    durationSeconds: 252,
    segments: [{ text: '本日はご来店ありがとうございます。', startTime: 4 }],
  }

  it('the newest row opens on arrival — a detail pane with no selection shows nothing', async () => {
    useWideViewport()
    getDiscardTranscript.mockResolvedValue(WITH_WORDS)
    await renderRows([{}, { id: 'd2', reason: 'ふたつめ' }])

    await waitFor(() => expect(getDiscardTranscript).toHaveBeenCalledWith('rs-1'))
    expect(screen.getByText(t('defRecordedAt'))).toBeInTheDocument()
  })

  it('the whole reason and the whole transcript are both on screen at once (⚖ 8/25 A)', async () => {
    useWideViewport()
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
    useWideViewport()
    await renderRows()

    await waitFor(() => screen.getByText(t('defRecordedAt')))
    expect(screen.getByText(t('defDuration'))).toBeInTheDocument()
    expect(screen.getByText(t('defStore'))).toBeInTheDocument()
    expect(screen.getByText(t('defDiscarded'))).toBeInTheDocument()
  })

  it('an unreadable fact reads 不明 in the definition row — a gap would misalign the grid', async () => {
    useWideViewport()
    await renderRows([{ storeName: null, durationSeconds: null, recordingCreatedAt: null }])

    await waitFor(() => screen.getByText(t('defStore')))
    // Three columns cannot be answered; 不明 is a statement about our knowledge,
    // not about the recording.
    expect(screen.getAllByText(t('unknownValue'))).toHaveLength(3)
  })

  it('pressing another row moves the selection — and never empties the pane', async () => {
    useWideViewport()
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
    useWideViewport()
    await renderRows()

    await waitFor(() => screen.getByText(t('defRecordedAt')))
    const selected = document.querySelector('[aria-current="true"]')
    expect(selected).not.toBeNull()
    expect(selected?.className).toContain('bg-primary/8')
    expect(selected?.className).toContain('border-primary')
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
