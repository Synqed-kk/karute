/** @jest-environment jsdom */
// RecordingDiscardReasonDialog — the written-reason sheet (recording-integrity
// spec §3.2, ⚖ 8/17 ruling; P5-A, ported off the parked A2 shell dd5814a6).
//
// Rendered against the REAL ja.json (menu-form-dialog.test.tsx's precedent), so
// a call-site key typo throws here rather than shipping a raw key to a phone.
//
// Three of these assertions are HONESTY pins, not UI pins:
//   - there is NO menu of reasons and no one-tap out — ⚖ 8/17 killed the
//     category vocabulary and the sub-floor pre-selection with it, so a staff
//     member must WRITE why every single time;
//   - the Phase-B "content is kept too" sentence must be absent from the render
//     AND from both message files — shipping it before B1's behaviour is the
//     exact dishonesty this lane exists to kill (§3.2 fix B7);
//   - a failed confirm must leave the dialog open with the typed reason intact,
//     because the discard did NOT happen (RecordPageView fails closed).
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json')
  return {
    useTranslations: (ns: string) => (key: string) => {
      let cur: unknown = ja
      for (const part of `${ns}.${key}`.split('.'))
        cur = (cur as Record<string, unknown> | undefined)?.[part]
      if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
      return cur
    },
  }
})

// @synqed-kk/ui ships ESM-only and isn't transformable in this suite — the
// same passthrough proxy record-page-outcome-double-tap.test.tsx uses. Button
// renders a REAL <button> so `disabled` is honored natively: a click on a
// disabled button is a DOM no-op, exactly as in production (the div
// passthrough it replaced was that suite's false-green root cause).
jest.mock('@synqed-kk/ui', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react') as typeof import('react')
  const passthrough = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('div', rest, children as React.ReactNode)
  const button = ({ children, ...rest }: Record<string, unknown> = {}) =>
    createElement('button', rest, children as React.ReactNode)
  return new Proxy(
    {},
    { get: (_target, prop) => (prop === 'Button' ? button : passthrough) },
  )
})

import { RecordingDiscardReasonDialog } from '@/components/karute/redesign/record/RecordingDiscardReasonDialog'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

/** The APPROVED mock (⚖ 8/17 later), transcribed — deliberately hardcoded so
 *  the copy Liam signed off cannot drift without this file going red. */
const CANON_BLOCK_JA = {
  title: '録音を破棄する理由',
  placeholder: '破棄する理由を入力してください（必須）',
  disclosure: '破棄の記録（日時・担当者・理由）が残ります。',
  confirm: '破棄する',
  failed: '保存できませんでした。もう一度お試しください。',
}
const CANON_BLOCK_EN = {
  title: 'Reason for discarding',
  placeholder: 'Enter the reason for discarding (required)',
  disclosure: 'A discard record (date/time, staff, reason) will be kept.',
  confirm: 'Discard',
  failed: 'Could not save. Please try again.',
}
/** Phase B's line. Ships in B1, WITH the behaviour it describes — never here. */
const PHASE_B_SENTENCE = '録音内容も方針により保存されます。'

const onConfirm = jest.fn()
const onCancel = jest.fn()
beforeEach(() => {
  onConfirm.mockClear()
  onCancel.mockClear()
})

function open(props: { submitting?: boolean; error?: string | null } = {}) {
  return render(
    <RecordingDiscardReasonDialog
      open
      submitting={props.submitting}
      error={props.error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
}
const confirmButton = () => screen.getByRole('button', { name: '破棄する' })
const cancelButton = () => screen.getByRole('button', { name: 'キャンセル' })
const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement
const type = (value: string) => fireEvent.change(textarea(), { target: { value } })

// ── 1. The written-reason form (⚖ 8/17) ────────────────────────────────────

describe('the form the ruling approved', () => {
  it('renders the title, the required textarea with its placeholder, and both buttons', () => {
    open()

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', CANON_BLOCK_JA.title)
    expect(screen.getByText(CANON_BLOCK_JA.title)).toBeInTheDocument()
    expect(textarea()).toHaveAttribute('placeholder', CANON_BLOCK_JA.placeholder)
    expect(confirmButton()).toBeInTheDocument()
    expect(cancelButton()).toBeInTheDocument()
  })

  // The whole ruling in one assertion: no menu, no pre-selection, no one-tap
  // out. If a category list ever comes back, this goes red.
  it('offers NO reason menu — no radios, no options, nothing pre-chosen', () => {
    open()

    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    // The dead vocabulary, by its labels.
    for (const dead of ['誤操作', '重複した録音', '施術に関係のない会話', '録音品質']) {
      expect(document.body.textContent).not.toContain(dead)
    }
  })

  it('the TEXTAREA takes focus on open, not the panel (⚖ 8/17 / packet A-1)', () => {
    open()

    // The just-clicked 破棄 button must lose focus (a stray Enter would
    // otherwise re-fire it behind the backdrop) AND the staff member must be
    // able to start typing immediately.
    expect(textarea()).toHaveFocus()
  })

  it('matches the canonical discardReason block, byte-exact, in both locales', () => {
    expect(ja.recording.discardReason).toEqual(CANON_BLOCK_JA)
    expect(en.recording.discardReason).toEqual(CANON_BLOCK_EN)
  })
})

// ── 2. The disclosure line — the whole point of Phase A ────────────────────

describe('the disclosure line (§3.2 fix B7)', () => {
  it('is always visible, never behind a tap', () => {
    open()

    expect(screen.getByText(CANON_BLOCK_JA.disclosure)).toBeInTheDocument()
  })

  it('never carries the Phase-B content sentence', () => {
    open()

    expect(document.body.textContent).not.toContain(PHASE_B_SENTENCE)
    expect(document.body.textContent).not.toContain('録音内容')
  })

  it('the Phase-B sentence is absent from both message files', () => {
    const jaBlock = JSON.stringify(ja.recording.discardReason)
    const enBlock = JSON.stringify(en.recording.discardReason)

    expect(jaBlock).toContain(CANON_BLOCK_JA.disclosure)
    expect(jaBlock).not.toContain(PHASE_B_SENTENCE)
    expect(jaBlock).not.toContain('録音内容')
    // Phase B's promise is about CONTENT being kept. Phase A keeps a receipt
    // and the written reason.
    expect(enBlock.toLowerCase()).not.toContain('content')
  })
})

// ── 3. The confirm gate — a reason must actually be written ────────────────

describe('confirm is disabled until a real reason is written', () => {
  it('opens with an empty field and confirm disabled', () => {
    open()

    expect(textarea()).toHaveValue('')
    expect(confirmButton()).toBeDisabled()

    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each(['', ' ', '   ', '\n\t '])('stays disabled for blank text (%j)', (value) => {
    open()
    type(value)

    expect(confirmButton()).toBeDisabled()
    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('enables on real text and confirms the TRIMMED reason', () => {
    open()
    type('  お客様が席を外したため録り直します  ')

    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('お客様が席を外したため録り直します')
  })

  it('cancel discards nothing', () => {
    open()
    type('打ち直します')
    fireEvent.click(cancelButton())

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

// ── 4. In-flight guard + fail-closed error ─────────────────────────────────

describe('submitting — the in-flight guard', () => {
  it('disables confirm, cancel and the textarea; every exit is a no-op', () => {
    open({ submitting: true })
    // The field is pre-filled by the parent's state in production; here the
    // guard alone is what must hold.
    expect(confirmButton()).toBeDisabled()
    expect(cancelButton()).toBeDisabled()
    expect(textarea()).toBeDisabled()

    fireEvent.click(confirmButton())
    fireEvent.click(cancelButton())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    // The backdrop scrim carries the same guard — a tap outside the panel
    // while submitting must also be a no-op.
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('a tap outside is a normal cancel when NOT submitting', () => {
    open()
    fireEvent.click(document.querySelector('.fixed.inset-0.bg-black\\/50') as Element)

    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('fail-closed — the discard did NOT happen', () => {
  it('renders the failure line and keeps the typed reason, retry still armed', () => {
    const { rerender } = open()
    type('録り直します')

    rerender(
      <RecordingDiscardReasonDialog
        open
        error={ja.recording.discardReason.failed}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(CANON_BLOCK_JA.failed)
    // The reason the staff member wrote survives the failure — they retype
    // nothing.
    expect(textarea()).toHaveValue('録り直します')
    expect(confirmButton()).toBeEnabled()
    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledWith('録り直します')
    // …and backing out is still possible.
    fireEvent.click(cancelButton())
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('renders no alert when there is no error', () => {
    open()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

// ── 5. Keyboard containment (Greptile r1, carried from the parked shell) ───

const dialog = () => screen.getByRole('dialog')

describe('keyboard containment', () => {
  it('Escape cancels the dialog', () => {
    open()

    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape is a no-op while submitting', () => {
    open({ submitting: true })

    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Tab wraps from the last focusable control back to the textarea', () => {
    open()
    type('録り直します') // enables confirm, which is then last in tab order

    confirmButton().focus()
    fireEvent.keyDown(dialog(), { key: 'Tab' })

    expect(textarea()).toHaveFocus()
  })

  it('Shift+Tab wraps from the textarea to the last control', () => {
    open()
    type('録り直します')

    textarea().focus()
    fireEvent.keyDown(dialog(), { key: 'Tab', shiftKey: true })

    expect(confirmButton()).toHaveFocus()
  })
})

// ── 6. Closed means gone ──────────────────────────────────────────────────

describe('open = false', () => {
  it('renders nothing', () => {
    const { container } = render(
      <RecordingDiscardReasonDialog open={false} onConfirm={onConfirm} onCancel={onCancel} />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a typed reason cannot survive a close and land on the next take', () => {
    const { rerender } = open()
    type('この録音は使いません')
    expect(confirmButton()).toBeEnabled()

    const props = { onConfirm, onCancel }
    rerender(<RecordingDiscardReasonDialog open={false} {...props} />)
    rerender(<RecordingDiscardReasonDialog open {...props} />)

    expect(textarea()).toHaveValue('')
    expect(confirmButton()).toBeDisabled()
  })
})
