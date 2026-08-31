/**
 * @jest-environment jsdom
 *
 * A2-4 — the opened discard row (packet P5-A2, ⚖ 8/25 ruling A).
 *
 * The written reason is the staffer's CLAIM. This screen is the only place a
 * manager can check it against what was actually said, so the row has to open
 * onto the transcript — and, when there is none, SAY WHICH KIND OF NONE it is.
 * Three honest answers, never a placeholder:
 *
 *   words kept          → the transcript
 *   under the floor     → nothing was ever transcribed (⚖ the spend gate)
 *   anything else       → no transcript was kept
 *
 * Asserted against the real ja.json copy, so a missing key fails here.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent, act } from '@testing-library/react'

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
const REASON = 'お客様を間違えて録音を開始してしまいました'

async function renderAndOpen() {
  listDiscardReasons.mockResolvedValue({
    ok: true,
    truncated: false,
    rows: [
      {
        id: 'd1',
        recordingSessionId: 'rs-1',
        createdAt: '2026-08-20T02:00:00.000Z',
        staffId: 'staff-A',
        staffName: '原 奏恵',
        reason: REASON,
      },
    ],
    counts: { thisMonth: 1, total: 1, byStaff: [] },
  })
  render(<DiscardReasonsSection />)
  await waitFor(() => screen.getByText(REASON))
  await act(async () => {
    fireEvent.click(screen.getByText(t('transcriptShow')))
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('破棄の記録 — the row opens onto what was recorded', () => {
  it('reads the transcript ON OPEN, not with the list (no N+1 for text nobody asked for)', async () => {
    getDiscardTranscript.mockResolvedValue({
      ok: true,
      segments: [{ text: '本日はご来店ありがとうございます。' }],
      durationSeconds: 125,
    })
    listDiscardReasons.mockResolvedValue({
      ok: true,
      truncated: false,
      rows: [
        {
          id: 'd1',
          recordingSessionId: 'rs-1',
          createdAt: '2026-08-20T02:00:00.000Z',
          staffId: 'staff-A',
          staffName: '原 奏恵',
          reason: REASON,
        },
      ],
      counts: { thisMonth: 1, total: 1, byStaff: [] },
    })
    render(<DiscardReasonsSection />)
    await waitFor(() => screen.getByText(REASON))
    expect(getDiscardTranscript).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptShow')))
    })
    expect(getDiscardTranscript).toHaveBeenCalledWith('rs-1')
    // The claim and what it is checked against are read TOGETHER.
    expect(screen.getByText(REASON)).toBeInTheDocument()
    expect(screen.getByText('本日はご来店ありがとうございます。')).toBeInTheDocument()
    expect(screen.getByText(t('transcriptTitle'))).toBeInTheDocument()
  })

  it('several segments read as a passage — every one of them on screen', async () => {
    getDiscardTranscript.mockResolvedValue({
      ok: true,
      segments: [
        { text: '一つ目。', startTime: 4 },
        { text: '二つ目。', startTime: 71 },
      ],
      durationSeconds: 90,
    })
    await renderAndOpen()
    // Since the 8/31 redesign each segment is its own line carrying its own
    // time, rather than one joined paragraph. What is pinned is what always
    // mattered: NOTHING the recording kept is dropped on the way to the screen.
    expect(screen.getByText('一つ目。')).toBeInTheDocument()
    expect(screen.getByText('二つ目。')).toBeInTheDocument()
    expect(screen.getByText('0:04')).toBeInTheDocument()
    expect(screen.getByText('1:11')).toBeInTheDocument()
    // …and IN ORDER. Before the redesign this test asserted one joined node
    // ('一つ目。 二つ目。'), which caught a reordering for free; each segment is
    // now its own line, so a pair of presence queries passes in either
    // direction. The twin sorts on `segment_index` precisely because that is
    // the order the words were written in, and this is the suite that owns
    // that claim — read the rendered lines back positionally.
    const lines = Array.from(document.querySelectorAll('p'))
      .map((p) => p.textContent ?? '')
      .filter((line) => line.includes('一つ目。') || line.includes('二つ目。'))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('一つ目。')
    expect(lines[1]).toContain('二つ目。')
  })

  it('under the accidental-tap floor: says nothing was ever recorded, not "no transcript"', async () => {
    getDiscardTranscript.mockResolvedValue({ ok: true, segments: [], durationSeconds: 4 })
    await renderAndOpen()
    expect(screen.getByText(t('transcriptBelowFloor', { n: 10 }))).toBeInTheDocument()
    expect(screen.queryByText(t('transcriptNone'))).toBeNull()
    // Rendering the right KEY is not the property — this state exists to say
    // that nothing was ever transcribed (⚖ the spend gate), which is a
    // different fact from "the words were not kept". Pinned on the sentence,
    // because a key comparison passes whatever the sentence happens to say.
    expect(t('transcriptBelowFloor', { n: 10 })).toContain('行っていません')
  })

  it('EXACTLY the floor is not under it — 10s reads as the plain absence', async () => {
    // Fix round 1, FIX-6. The floor is `< 10`, so a take of exactly 10.0s WAS
    // sent to transcription — its silence is "the words were not kept", never
    // "nothing was ever recorded". The boundary is the one value the two
    // sentences meet at, and a predicate loosened to `<=` would put a
    // transcribed take on the untranscribed side of it.
    getDiscardTranscript.mockResolvedValue({ ok: true, segments: [], durationSeconds: 10 })
    await renderAndOpen()
    expect(screen.getByText(t('transcriptNone'))).toBeInTheDocument()
    expect(screen.queryByText(t('transcriptBelowFloor', { n: 10 }))).toBeNull()
  })

  it('no words and no duration to explain them: the plain honest absence', async () => {
    getDiscardTranscript.mockResolvedValue({ ok: true, segments: [], durationSeconds: null })
    await renderAndOpen()
    expect(screen.getByText(t('transcriptNone'))).toBeInTheDocument()
  })

  it('a long-enough recording with no words kept is NOT the too-short answer', async () => {
    getDiscardTranscript.mockResolvedValue({ ok: true, segments: [], durationSeconds: 600 })
    await renderAndOpen()
    expect(screen.getByText(t('transcriptNone'))).toBeInTheDocument()
  })

  it('a refused or failed read says so — never a blank panel that reads as "nothing was said"', async () => {
    getDiscardTranscript.mockResolvedValue({ ok: false, error: 'forbidden' })
    await renderAndOpen()
    expect(screen.getByText(t('transcriptFailed'))).toBeInTheDocument()
  })

  it('a transport failure is a failure too, not an endless spinner', async () => {
    getDiscardTranscript.mockRejectedValue(new Error('offline'))
    await renderAndOpen()
    expect(screen.getByText(t('transcriptFailed'))).toBeInTheDocument()
  })

  it('both halves are labelled — the claim as well as the evidence', async () => {
    // ⚖ 8/25 ruling A: the manager reads the staffer's CLAIM against the
    // EVIDENCE. An opened row is two runs of Japanese prose, and only labelling
    // the lower one let the reason read as part of the system's record.
    getDiscardTranscript.mockResolvedValue({
      ok: true,
      segments: [{ text: '本日はご来店ありがとうございます。' }],
      durationSeconds: 125,
    })
    await renderAndOpen()
    expect(screen.getByText(t('reasonLabel'))).toBeInTheDocument()
    expect(screen.getByText(t('transcriptTitle'))).toBeInTheDocument()
  })

  it('re-opening after a FAILED read tries again — a failure is not an answer', async () => {
    // Caching the error like a success made a recoverable blip look settled:
    // 「読み込めませんでした」 stood until a full page reload, and the row is the
    // only retry affordance this screen has.
    getDiscardTranscript.mockRejectedValueOnce(new Error('offline'))
    await renderAndOpen()
    expect(screen.getByText(t('transcriptFailed'))).toBeInTheDocument()

    getDiscardTranscript.mockResolvedValue({
      ok: true,
      segments: [{ text: '本日はご来店ありがとうございます。' }],
      durationSeconds: 125,
    })
    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptHide')))
    })
    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptShow')))
    })
    expect(getDiscardTranscript).toHaveBeenCalledTimes(2)
    expect(screen.getByText('本日はご来店ありがとうございます。')).toBeInTheDocument()
  })

  it('closing and re-opening a row does not re-read core', async () => {
    getDiscardTranscript.mockResolvedValue({
      ok: true,
      segments: [{ text: '本日はご来店ありがとうございます。' }],
      durationSeconds: 125,
    })
    await renderAndOpen()
    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptHide')))
    })
    expect(screen.queryByText('本日はご来店ありがとうございます。')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByText(t('transcriptShow')))
    })
    expect(getDiscardTranscript).toHaveBeenCalledTimes(1)
    expect(screen.getByText('本日はご来店ありがとうございます。')).toBeInTheDocument()
  })
})
