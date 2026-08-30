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
