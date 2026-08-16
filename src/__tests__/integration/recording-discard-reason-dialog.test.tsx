/** @jest-environment jsdom */
// RecordingDiscardReasonDialog — the discard reason sheet (recording-integrity
// spec §3.2 / §3.5, PR A2).
//
// Rendered against the REAL ja.json (menu-form-dialog.test.tsx's precedent), so
// a call-site key typo throws here rather than shipping a raw key to a phone.
//
// Three of these assertions are HONESTY pins, not UI pins:
//   - the Phase-B "content is kept too" sentence must be absent from the render
//     AND from both message files — shipping it before B1's behaviour is the
//     exact dishonesty this lane exists to kill (§3.2 fix B7);
//   - `abandoned` is system-only and must never be offered (fix A8);
//   - there is no free-text field, because free text has nowhere to live in
//     Phase A (§10.1) and collecting it to drop it would be worse than none.
//
// Schema behaviour (every staff category accepted, `abandoned` accepted, an
// unknown category refused) is already pinned by A1's
// recording-discard-receipt.test.ts §4/§5 — not duplicated here. What IS pinned
// here is the seam A2 creates: that the server's vocabulary and the dialog's
// options come from one module and cannot drift apart.
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
import {
  DISCARD_CATEGORIES,
  STAFF_DISCARD_CATEGORIES,
  type StaffDiscardCategory,
} from '@/lib/recording/discard-reasons'
import ja from '../../../messages/ja.json'
import en from '../../../messages/en.json'

/** The §3.2 table, transcribed from the spec — deliberately hardcoded so the
 *  vocabulary cannot be renamed or reordered without this file going red. */
const CANON_JA: Array<[StaffDiscardCategory, string]> = [
  ['mistap', '誤操作・テスト録音'],
  ['quality', '録音品質が悪い（雑音・音切れ）'],
  ['duplicate', '重複した録音'],
  ['wrong_target', '別のお客様・別の担当者の録音'],
  ['not_session', '施術に関係のない会話'],
]
const DISCLOSURE_JA = '破棄の記録（日時・担当者・理由）が残ります。'
/** Phase B's line. Ships in B1, WITH the behaviour it describes — never here. */
const PHASE_B_SENTENCE = '録音内容も方針により保存されます。'

/** The full canonical `recording.discardReason` object, both locales,
 *  transcribed exactly (fix F-A/F-B). A deepEqual against this block pins
 *  EVERY value — the five labels, both disclosures, both help lines — so any
 *  drift anywhere in the block (a renamed EN label, a reworded retention
 *  promise slipped into either help/disclosure line) goes red here, not just
 *  in production. */
const CANON_BLOCK_JA = {
  title: '録音を破棄する理由',
  category: {
    mistap: '誤操作・テスト録音',
    quality: '録音品質が悪い（雑音・音切れ）',
    duplicate: '重複した録音',
    wrong_target: '別のお客様・別の担当者の録音',
    not_session: '施術に関係のない会話',
  },
  disclosure: '破棄の記録（日時・担当者・理由）が残ります。',
  help: 'お客様からのお申し出があった場合は、録音を停止し通常どおり対応のうえ、最も近い理由を選択してください。',
  confirm: '破棄する',
}
const CANON_BLOCK_EN = {
  title: 'Reason for discarding',
  category: {
    mistap: 'Mis-tap / test',
    quality: 'Poor audio quality',
    duplicate: 'Duplicate take',
    wrong_target: 'Wrong customer or staff',
    not_session: 'Not a session',
  },
  disclosure: 'A discard record (date/time, staff, reason) will be kept.',
  help: 'If a customer asks you to stop or delete the recording, stop and handle it as you do today, then pick the closest reason.',
  confirm: 'Discard',
}

const onConfirm = jest.fn()
const onCancel = jest.fn()
beforeEach(() => {
  onConfirm.mockClear()
  onCancel.mockClear()
})

function open(belowFloor: boolean, submitting?: boolean) {
  return render(
    <RecordingDiscardReasonDialog
      open
      belowFloor={belowFloor}
      submitting={submitting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  )
}
const confirmButton = () => screen.getByRole('button', { name: '破棄する' })
const cancelButton = () => screen.getByRole('button', { name: 'キャンセル' })

// ── 1. The closed vocabulary ───────────────────────────────────────────────

describe('the five categories (§3.2)', () => {
  it('renders exactly the five staff categories, in canon order, with canon labels', () => {
    open(false)

    const options = screen.getAllByRole('radio')
    expect(options).toHaveLength(5)
    expect(options.map((o) => o.textContent)).toEqual(CANON_JA.map(([, label]) => label))
    // …and the codes behind them, in the same order.
    expect([...STAFF_DISCARD_CATEGORIES]).toEqual(CANON_JA.map(([code]) => code))
  })

  it('never offers `abandoned`, even though the full vocabulary carries it', () => {
    open(false)

    expect(DISCARD_CATEGORIES).toContain('abandoned')
    expect(STAFF_DISCARD_CATEGORIES).not.toContain('abandoned')
  })

  it('never offers the Phase-B categories (customer_request / その他)', () => {
    open(false)

    expect(DISCARD_CATEGORIES).not.toContain('customer_request')
    expect(DISCARD_CATEGORIES).not.toContain('other')
    expect(document.body.textContent).not.toContain('その他')
    expect(document.body.textContent).not.toContain('お客様の申し出')
  })

  it('is one vocabulary: the server list is the staff list plus the system code', () => {
    // The seam A2 creates. discard.ts's z.enum reads DISCARD_CATEGORIES, the
    // dialog reads STAFF_DISCARD_CATEGORIES — if this identity ever breaks, a
    // staff member could pick a category the receipt route would 400 on.
    // (Acceptance/refusal itself: recording-discard-receipt.test.ts §4/§5.)
    expect([...DISCARD_CATEGORIES]).toEqual([...STAFF_DISCARD_CATEGORIES, 'abandoned'])
  })

  it('has no free-text field (§10.1 — `detail` is ids/flags only)', () => {
    open(false)

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelector('input, textarea')).toBeNull()
  })
})

// ── 2. The disclosure line — the whole point of Phase A ────────────────────

describe('the disclosure line (§3.2 fix B7)', () => {
  it.each([true, false])('is always visible (belowFloor=%s)', (belowFloor) => {
    open(belowFloor)

    expect(screen.getByText(DISCLOSURE_JA)).toBeInTheDocument()
  })

  it.each([true, false])(
    'never carries the Phase-B content sentence (belowFloor=%s)',
    (belowFloor) => {
      open(belowFloor)

      expect(document.body.textContent).not.toContain(PHASE_B_SENTENCE)
      expect(document.body.textContent).not.toContain('録音内容')
    },
  )

  it('the Phase-B sentence is absent from both message files', () => {
    const jaBlock = JSON.stringify(ja.recording.discardReason)
    const enBlock = JSON.stringify(en.recording.discardReason)

    expect(jaBlock).toContain(DISCLOSURE_JA)
    expect(jaBlock).not.toContain(PHASE_B_SENTENCE)
    expect(jaBlock).not.toContain('録音内容')
    // Phase B's promise is about CONTENT being kept. Phase A keeps a receipt.
    expect(enBlock.toLowerCase()).not.toContain('content')
  })

  it('matches the canonical discardReason block, byte-exact, in both locales (fix F-A/F-B)', () => {
    expect(ja.recording.discardReason).toEqual(CANON_BLOCK_JA)
    expect(en.recording.discardReason).toEqual(CANON_BLOCK_EN)
  })

  it('states the Phase-A customer-asked reality in the help line (§14.1)', () => {
    open(false)

    expect(screen.getByText(ja.recording.discardReason.help)).toBeInTheDocument()
  })
})

// ── 3. The floor (§3.5) and the confirm gate ──────────────────────────────

describe('belowFloor = true — one tap to confirm', () => {
  it('opens with mistap pre-selected and confirms it in a single tap', () => {
    open(true)

    const [mistap, ...rest] = screen.getAllByRole('radio')
    expect(mistap).toHaveAttribute('aria-checked', 'true')
    expect(rest.every((o) => o.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(confirmButton()).toBeEnabled()

    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('mistap')
  })
})

describe('belowFloor = false — a reason must be stated', () => {
  it('opens with nothing selected and confirm disabled', () => {
    open(false)

    expect(screen.getAllByRole('radio').every((o) => o.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(confirmButton()).toBeDisabled()

    fireEvent.click(confirmButton())
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirms the category the staff member actually picked', () => {
    open(false)

    fireEvent.click(screen.getByText('別のお客様・別の担当者の録音'))
    const [, , , wrongTarget] = screen.getAllByRole('radio')
    expect(wrongTarget).toHaveAttribute('aria-checked', 'true')
    expect(confirmButton()).toBeEnabled()

    fireEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith('wrong_target')
  })

  it('cancel discards nothing', () => {
    open(false)

    fireEvent.click(screen.getByText('重複した録音'))
    fireEvent.click(cancelButton())

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('submitting — the in-flight guard (fix F-C)', () => {
  it('with a selection already made, submitting=true disables confirm and cancel; a click is a no-op', () => {
    open(true, true) // belowFloor pre-selects mistap, so there IS a selection

    expect(confirmButton()).toBeDisabled()
    expect(cancelButton()).toBeDisabled()

    fireEvent.click(confirmButton())
    fireEvent.click(cancelButton())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()

    // The backdrop scrim carries the same guard (delta-verify Finding 1) —
    // a tap outside the panel while submitting must also be a no-op.
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onCancel).not.toHaveBeenCalled()
  })
})

// ── 4. Keyboard containment (Greptile r1) ──────────────────────────────────
// Hand-rolled panel, so no focus-trap library gives this for free: Escape
// must cancel (guarded by `submitting`, same as the other three exits) and
// Tab/Shift+Tab must stay inside the panel rather than escaping to the page.

const dialog = () => screen.getByRole('dialog')

describe('keyboard containment (Greptile r1)', () => {
  it('Escape cancels the dialog', () => {
    open(false)

    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('Escape is a no-op while submitting', () => {
    open(false, true)

    fireEvent.keyDown(dialog(), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('Tab wraps from the last focusable control back to the first', () => {
    open(true) // belowFloor pre-selects mistap, so confirm is enabled and last in tab order

    confirmButton().focus()
    expect(confirmButton()).toHaveFocus()

    fireEvent.keyDown(dialog(), { key: 'Tab' })
    expect(screen.getAllByRole('radio')[0]).toHaveFocus()
  })

  it('Shift+Tab wraps from the first focusable control to the last', () => {
    open(true)

    const first = screen.getAllByRole('radio')[0]
    first.focus()
    expect(first).toHaveFocus()

    fireEvent.keyDown(dialog(), { key: 'Tab', shiftKey: true })
    expect(confirmButton()).toHaveFocus()
  })
})

// ── 5. Closed means gone ──────────────────────────────────────────────────

describe('open = false', () => {
  it('renders nothing', () => {
    const { container } = render(
      <RecordingDiscardReasonDialog
        open={false}
        belowFloor
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a selection cannot survive a close and land on the next take', () => {
    const { rerender } = open(false)
    fireEvent.click(screen.getByText('重複した録音'))
    expect(confirmButton()).toBeEnabled()

    const props = { belowFloor: false, onConfirm, onCancel }
    rerender(<RecordingDiscardReasonDialog open={false} {...props} />)
    rerender(<RecordingDiscardReasonDialog open {...props} />)

    expect(screen.getAllByRole('radio').every((o) => o.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(confirmButton()).toBeDisabled()
  })
})
