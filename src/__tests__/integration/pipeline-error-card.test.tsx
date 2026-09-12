/**
 * @jest-environment jsdom
 *
 * PipelineErrorCard (record page): pipeline failures must surface LOCALIZED
 * text from the stable error code — the empty-transcript throw used to render
 * its raw English message ('Transcription returned an empty transcript.')
 * verbatim mid-app. The card takes a code, not a message, so raw exception
 * text can no longer reach the screen by construction; these pin the ja
 * strings and the retry/cancel wiring.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineErrorCard } from '@/components/karute/redesign/record/PipelineErrorCard'

// next-intl production-ESM vs CI node 20 (see thin-bottom-nav.test.tsx) —
// mock the hook, feed it the REAL ja.json so the assertions stay honest.
jest.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => {
    const messages = jest.requireActual<Record<string, Record<string, string>>>(
      '../../../messages/ja.json',
    )
    // The card uses the flat 'recording' + 'common' namespaces only.
    return messages[ns]?.[key] ?? key
  },
}))

const noop = () => {}

describe('PipelineErrorCard (localized pipeline failures)', () => {
  it('renders the ja empty-transcript message for its code', () => {
    render(<PipelineErrorCard code="empty-transcript" onCancel={noop} onRetry={noop} />)
    expect(screen.getByText(/音声が認識できませんでした/)).toBeTruthy()
    expect(screen.queryByText(/Transcription/)).toBeNull()
  })

  it('renders the generic ja message for unknown and null codes', () => {
    const { rerender } = render(
      <PipelineErrorCard code="unknown" onCancel={noop} onRetry={noop} />,
    )
    expect(screen.getByText(/処理中にエラーが発生しました/)).toBeTruthy()
    rerender(<PipelineErrorCard code={null} onCancel={noop} onRetry={noop} />)
    expect(screen.getByText(/処理中にエラーが発生しました/)).toBeTruthy()
  })

  it('⚖ R7: a DISCARDED code renders its own sentence and NO retry button', () => {
    // A staff member threw this recording away and wrote why. Core re-arms the
    // same job on every retry and the worker refuses it on exactly the same
    // ground, so a 再試行 here could never land. Cancel stays — the staffer
    // still has to leave the screen.
    render(<PipelineErrorCard code="discarded" onCancel={noop} onRetry={noop} />)
    expect(screen.getByText(/この録音はスタッフが破棄したため/)).toBeTruthy()
    expect(screen.queryByText(/処理中にエラーが発生しました/)).toBeNull()
    expect(screen.queryByRole('button', { name: '再試行' })).toBeNull()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeTruthy()
  })

  it('the three existing codes keep their retry button', () => {
    const { rerender } = render(
      <PipelineErrorCard code="empty-transcript" onCancel={noop} onRetry={noop} />,
    )
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy()
    rerender(<PipelineErrorCard code="consent-required" onCancel={noop} onRetry={noop} />)
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy()
    rerender(<PipelineErrorCard code={null} onCancel={noop} onRetry={noop} />)
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy()
  })

  it('wires retry and cancel', () => {
    const onCancel = jest.fn()
    const onRetry = jest.fn()
    render(<PipelineErrorCard code="unknown" onCancel={onCancel} onRetry={onRetry} />)
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

// ⚖ 8/26 rider (banner dead-loop exit), ruled case (a): the discard exit
// renders ONLY on empty-transcript + an onDiscard handler — every other code,
// or no handler, stays byte-identical to today.
describe('the discard exit (⚖ 8/26 rider)', () => {
  it('renders and fires only when code is empty-transcript AND onDiscard is provided', () => {
    const onDiscard = jest.fn()
    const { rerender } = render(
      <PipelineErrorCard
        code="empty-transcript"
        onCancel={noop}
        onRetry={noop}
        onDiscard={onDiscard}
      />,
    )
    fireEvent.click(screen.getByText('録音を破棄する'))
    expect(onDiscard).toHaveBeenCalledTimes(1)

    // No onDiscard → byte-identical to today, even for the qualifying code.
    rerender(<PipelineErrorCard code="empty-transcript" onCancel={noop} onRetry={noop} />)
    expect(screen.queryByText('録音を破棄する')).toBeNull()
  })

  it('never renders for a non-qualifying code, even when onDiscard is provided', () => {
    const onDiscard = jest.fn()
    const { rerender } = render(
      <PipelineErrorCard code="unknown" onCancel={noop} onRetry={noop} onDiscard={onDiscard} />,
    )
    expect(screen.queryByText('録音を破棄する')).toBeNull()
    rerender(
      <PipelineErrorCard
        code="consent-required"
        onCancel={noop}
        onRetry={noop}
        onDiscard={onDiscard}
      />,
    )
    expect(screen.queryByText('録音を破棄する')).toBeNull()
    rerender(<PipelineErrorCard code={null} onCancel={noop} onRetry={noop} onDiscard={onDiscard} />)
    expect(screen.queryByText('録音を破棄する')).toBeNull()
  })
})

// FIX ROUND, missing render proof (a) — UPDATE 25 GROUP A, piece c: the
// "retrying gave the same result" line renders ONLY when errorRepeated, and
// 再試行 is NEVER removed by it (B2's own rule — a wrong detector must never
// lock a real take out).
describe('errorRepeated (⚖ UPDATE 25 GROUP A, piece c)', () => {
  it('renders the repeat line when errorRepeated, and 再試行 stays rendered', () => {
    render(
      <PipelineErrorCard code="empty-transcript" onCancel={noop} onRetry={noop} errorRepeated />,
    )
    expect(screen.getByText('再試行しても同じ結果でした。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy()
  })

  it('omits the repeat line when errorRepeated is false/absent', () => {
    const { rerender } = render(
      <PipelineErrorCard code="empty-transcript" onCancel={noop} onRetry={noop} />,
    )
    expect(screen.queryByText('再試行しても同じ結果でした。')).toBeNull()
    rerender(
      <PipelineErrorCard
        code="empty-transcript"
        onCancel={noop}
        onRetry={noop}
        errorRepeated={false}
      />,
    )
    expect(screen.queryByText('再試行しても同じ結果でした。')).toBeNull()
  })
})

// FIX ROUND, missing render proof (b) — UPDATE 25 GROUP A, piece c: the
// same-day 手書き door renders ONLY for empty-transcript, and ONLY when the
// caller passes onHandwrite (the caller has already proven sameDay before
// ever reaching this prop — see RecordPageView).
describe('the 手書き door (⚖ UPDATE 25 GROUP A, piece c)', () => {
  // This suite's next-intl mock (top of file) does a FLAT `messages[ns][key]`
  // lookup — it does not walk dotted/nested keys, so `t('inbox.action.handwrite')`
  // (a NESTED key: recording.inbox.action.handwrite) falls through to the raw
  // key string, same as every other lookup miss in this mock. Asserting on
  // that literal string is still a real proof: it is the exact text the
  // button renders under this harness, and the click still exercises the
  // real component code (handwriteFor's gate + the onClick wiring).
  const HANDWRITE_TEXT = 'inbox.action.handwrite'

  it('renders for empty-transcript when onHandwrite is given, and fires it', () => {
    const onHandwrite = jest.fn()
    render(
      <PipelineErrorCard
        code="empty-transcript"
        onCancel={noop}
        onRetry={noop}
        onHandwrite={onHandwrite}
      />,
    )
    fireEvent.click(screen.getByText(HANDWRITE_TEXT))
    expect(onHandwrite).toHaveBeenCalledTimes(1)
  })

  it('does not render when onHandwrite is absent, even for empty-transcript', () => {
    render(<PipelineErrorCard code="empty-transcript" onCancel={noop} onRetry={noop} />)
    expect(screen.queryByText(HANDWRITE_TEXT)).toBeNull()
  })

  it('never renders for a non-qualifying code, even when onHandwrite is given', () => {
    const onHandwrite = jest.fn()
    const { rerender } = render(
      <PipelineErrorCard code="unknown" onCancel={noop} onRetry={noop} onHandwrite={onHandwrite} />,
    )
    expect(screen.queryByText(HANDWRITE_TEXT)).toBeNull()
    rerender(
      <PipelineErrorCard
        code="consent-required"
        onCancel={noop}
        onRetry={noop}
        onHandwrite={onHandwrite}
      />,
    )
    expect(screen.queryByText(HANDWRITE_TEXT)).toBeNull()
    rerender(
      <PipelineErrorCard code={null} onCancel={noop} onRetry={noop} onHandwrite={onHandwrite} />,
    )
    expect(screen.queryByText(HANDWRITE_TEXT)).toBeNull()
  })
})
