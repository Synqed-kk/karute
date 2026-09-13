/**
 * @jest-environment jsdom
 *
 * RecordingShareToggle — the recorder's own 共有 toggle (⚖ Liam 2026-09-13
 * sharing law; 2026-09-14 design D11 FINAL: one-tap, REVERSIBLE, no confirm
 * of any kind, no sheet, no dialog — the control's own state IS the
 * feedback). Rendered against the REAL ja catalog so a hardcoded string or a
 * missing key fails here rather than in the field.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'

jest.mock('next-intl', () => {
  const ja = jest.requireActual('../../../messages/ja.json') as Record<string, unknown>
  return {
    useTranslations:
      (ns: string) =>
      (key: string, vars?: Record<string, unknown>) => {
        let cur: unknown = ja
        for (const part of `${ns}.${key}`.split('.')) {
          cur = (cur as Record<string, unknown> | undefined)?.[part]
        }
        // A key that does not resolve must FAIL, never echo — an echo would
        // let a missing ja string pass every assertion below.
        if (typeof cur !== 'string') throw new Error(`missing ja.json key: ${ns}.${key}`)
        return cur.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? ''))
      },
  }
})

const refresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: (...a: unknown[]) => refresh(...a) }),
}))

const setRecordingShared = jest.fn()
jest.mock('@/actions/recording-share', () => ({
  setRecordingShared: (...a: unknown[]) => setRecordingShared(...a),
}))

import { RecordingShareToggle } from '@/components/karute/redesign/detail/RecordingShareToggle'

beforeEach(() => {
  refresh.mockClear()
  setRecordingShared.mockReset()
})

describe('RecordingShareToggle', () => {
  it('idle renders the bordered 「管理者に共有」 button, aria-pressed=false, no black fill', () => {
    render(<RecordingShareToggle karuteId="k-1" shared={false} />)
    const button = screen.getByRole('button', { name: '管理者に共有' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button.className).not.toMatch(/bg-foreground|bg-black|bg-sage-800/)
  })

  it('tap on idle → setRecordingShared(id, true) → busy shows the spinner label, disabled → router.refresh() on success', async () => {
    let resolve!: (v: { ok: true; shared: boolean }) => void
    setRecordingShared.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    render(<RecordingShareToggle karuteId="k-1" shared={false} />)

    fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
    expect(setRecordingShared).toHaveBeenCalledWith('k-1', true)
    expect(screen.getByRole('button')).toBeDisabled()
    expect(screen.getByText('共有中…')).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()

    await act(async () => {
      resolve({ ok: true, shared: true })
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('shared renders the washed 「共有中」 chip, aria-pressed=true', () => {
    render(<RecordingShareToggle karuteId="k-1" shared={true} />)
    const button = screen.getByRole('button', { name: '共有中' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button.className).toMatch(/sky-500/)
  })

  it('tap on the shared chip → setRecordingShared(id, false) — one-tap narrowing, no confirm', async () => {
    setRecordingShared.mockResolvedValue({ ok: true, shared: false })
    render(<RecordingShareToggle karuteId="k-1" shared={true} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '共有中' }))
    })
    expect(setRecordingShared).toHaveBeenCalledWith('k-1', false)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('a refused write shows the native failure line beside the control, and the control stays — never replaced', async () => {
    setRecordingShared.mockResolvedValue({ ok: false, error: 'forbidden' })
    render(<RecordingShareToggle karuteId="k-1" shared={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
    })
    expect(screen.getByText('共有できませんでした')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理者に共有' })).toBeInTheDocument()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('a second successful tap clears a previous failure line', async () => {
    setRecordingShared.mockResolvedValueOnce({ ok: false, error: 'upstream' })
    render(<RecordingShareToggle karuteId="k-1" shared={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
    })
    expect(screen.getByText('共有できませんでした')).toBeInTheDocument()

    setRecordingShared.mockResolvedValueOnce({ ok: true, shared: true })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
    })
    expect(screen.queryByText('共有できませんでした')).not.toBeInTheDocument()
  })

  it('busy disables the control regardless of direction', async () => {
    let resolve!: (v: { ok: true; shared: boolean }) => void
    setRecordingShared.mockReturnValue(
      new Promise((r) => {
        resolve = r
      }),
    )
    render(<RecordingShareToggle karuteId="k-1" shared={true} />)
    fireEvent.click(screen.getByRole('button', { name: '共有中' }))
    expect(screen.getByRole('button')).toBeDisabled()
    await act(async () => {
      resolve({ ok: true, shared: false })
    })
  })

  // FIX ROUND 1 (Fable line-audit, 2026-09-14): setBusy(false) used to run
  // BEFORE router.refresh()'s round-trip resolved, so a successful share
  // flashed back to the stale 管理者に共有 label for the length of that
  // round-trip — reading as a failed tap. optimistic display fixes it.
  it('after a successful share tap the chip shows 共有中 IMMEDIATELY, before any prop change', async () => {
    setRecordingShared.mockResolvedValue({ ok: true, shared: true })
    render(<RecordingShareToggle karuteId="k-1" shared={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
    })
    // The `shared` PROP is still false (no rerender happened) — only the
    // optimistic display should be showing 共有中 here.
    expect(screen.getByRole('button', { name: '共有中' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '管理者に共有' })).not.toBeInTheDocument()
  })

  it('when the prop arrives as a genuinely NEW value (a real change) the display reverts to it instantly — no timer needed', async () => {
    setRecordingShared.mockResolvedValue({ ok: true, shared: false })
    const { rerender } = render(<RecordingShareToggle karuteId="k-1" shared={true} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '共有中' }))
    })
    expect(screen.getByRole('button', { name: '管理者に共有' })).toBeInTheDocument()

    // The refreshed DTO confirms the unshare (true → false is a REAL value
    // transition React's prop-diff effect detects immediately) — still
    // showing the same label proves the effect didn't have to wait for the
    // settle timer here.
    rerender(<RecordingShareToggle karuteId="k-1" shared={false} />)
    expect(screen.getByRole('button', { name: '管理者に共有' })).toBeInTheDocument()
  })

  // DISCLOSED GAP (found while writing this exact test, per the packet's own
  // scenario): for a BOOLEAN prop, "the server disagreed" can only mean the
  // refetched value equals what `shared` ALREADY was before this tap — which
  // is not a value CHANGE from this component's last render, so
  // useEffect(…, [shared]) alone can never observe it (React's dependency
  // diff sees no difference to react to). The settle TIMEOUT is what
  // actually closes this case — bounded, not instant. Faked here rather than
  // waited out for real.
  it('when the prop later arrives back at the OLD value (server disagreed) the display reverts to 管理者に共有 once the settle timer fires', async () => {
    jest.useFakeTimers()
    try {
      setRecordingShared.mockResolvedValue({ ok: true, shared: true })
      const { rerender } = render(<RecordingShareToggle karuteId="k-1" shared={false} />)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
      })
      expect(screen.getByRole('button', { name: '共有中' })).toBeInTheDocument()

      // The refetched DTO says the write did NOT actually stick (another
      // actor's write raced it, or core's second lock refused it after
      // all) — the prop arrives back at false, identical to its own
      // pre-tap value, so the prop-diff effect alone cannot see this.
      rerender(<RecordingShareToggle karuteId="k-1" shared={false} />)
      expect(screen.getByRole('button', { name: '共有中' })).toBeInTheDocument()

      await act(async () => {
        jest.advanceTimersByTime(5000)
      })
      expect(screen.getByRole('button', { name: '管理者に共有' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '共有中' })).not.toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })

  it('a failed tap never leaves the optimistic state stuck — display returns to the real prop', async () => {
    setRecordingShared.mockResolvedValueOnce({ ok: true, shared: true })
    render(<RecordingShareToggle karuteId="k-1" shared={false} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '管理者に共有' }))
    })
    expect(screen.getByRole('button', { name: '共有中' })).toBeInTheDocument()

    // A second tap (narrowing back) FAILS — optimistic must clear rather
    // than freeze on the mid-flight guess; with no prop change, that means
    // falling back to the still-unrefreshed `shared` prop (false).
    setRecordingShared.mockResolvedValueOnce({ ok: false, error: 'upstream' })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '共有中' }))
    })
    expect(setRecordingShared).toHaveBeenLastCalledWith('k-1', false)
    expect(screen.getByRole('button', { name: '管理者に共有' })).toBeInTheDocument()
    expect(screen.getByText('共有できませんでした')).toBeInTheDocument()
  })
})
