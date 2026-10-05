/**
 * @jest-environment jsdom
 *
 * Unit coverage for useLongPress (PR #96/replay/22): hold-past-threshold fires
 * onLongPress; early release fires onShortTap; leave/cancel fires neither.
 * S103 contract: onShortTap runs from the element's CLICK (the returned
 * onClick), never from pointerup — a pointerup the engine never follows with a
 * click opens nothing, and the click trailing a hold or a drag is swallowed.
 * Movement tolerance (booking-page drag bug): pointer travel past 10px is a
 * scroll attempt, not a tap or a hold — fires neither.
 */
import { renderHook, act } from '@testing-library/react'
import { useLongPress } from '@/hooks/use-long-press'

// The hook only reads clientX/clientY off the pointer event.
const pt = (x = 0, y = 0) => ({ clientX: x, clientY: y }) as React.PointerEvent
/** A finger/mouse click carries detail ≥ 1; the keyboard's click carries 0. */
const TAP = { detail: 1 } as React.MouseEvent
const KEY = { detail: 0 } as React.MouseEvent

beforeEach(() => jest.useFakeTimers())
afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('useLongPress', () => {
  it('fires onLongPress (not onShortTap) when held past the threshold', () => {
    const onLongPress = jest.fn()
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => {
      jest.advanceTimersByTime(450)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
    act(() => result.current.onPointerUp())
    act(() => result.current.onClick?.(TAP)) // the click that trails the hold
    expect(onShortTap).not.toHaveBeenCalled()
  })

  it('fires onShortTap (not onLongPress) when released before the threshold', () => {
    const onLongPress = jest.fn()
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => {
      jest.advanceTimersByTime(200)
    })
    act(() => result.current.onPointerUp())
    expect(onShortTap).not.toHaveBeenCalled() // pointerup alone opens nothing
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).toHaveBeenCalledTimes(1)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('fires neither when the pointer leaves before the threshold', () => {
    const onLongPress = jest.fn()
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => {
      jest.advanceTimersByTime(100)
    })
    act(() => result.current.onPointerLeave())
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(onLongPress).not.toHaveBeenCalled()
    expect(onShortTap).not.toHaveBeenCalled()
  })

  it('respects a custom threshold', () => {
    const onLongPress = jest.fn()
    const { result } = renderHook(() => useLongPress({ thresholdMs: 1000, onLongPress }))
    act(() => result.current.onPointerDown(pt()))
    act(() => {
      jest.advanceTimersByTime(450)
    })
    expect(onLongPress).not.toHaveBeenCalled()
    act(() => {
      jest.advanceTimersByTime(550)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('does not require an onShortTap callback', () => {
    const onLongPress = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))
    act(() => result.current.onPointerDown(pt()))
    act(() => result.current.onPointerUp())
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('fires neither when the pointer drags past the tolerance then lifts (scroll attempt)', () => {
    const onLongPress = jest.fn()
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    act(() => result.current.onPointerDown(pt(0, 0)))
    act(() => result.current.onPointerMove(pt(0, 30)))
    act(() => {
      jest.advanceTimersByTime(200)
    })
    act(() => result.current.onPointerUp())
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('does not fire onLongPress when the pointer drags past the tolerance and holds', () => {
    const onLongPress = jest.fn()
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    act(() => result.current.onPointerDown(pt(0, 0)))
    act(() => result.current.onPointerMove(pt(0, 30)))
    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(onLongPress).not.toHaveBeenCalled()
    act(() => result.current.onPointerUp())
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).not.toHaveBeenCalled()
  })

  it('ignores a pointerup with no preceding pointerdown (overlay click-through)', () => {
    const onLongPress = jest.fn()
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    // mouseup lands here after a dialog overlay swallowed the mousedown
    act(() => result.current.onPointerUp())
    expect(onShortTap).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
    // a second stray pointerup after a completed tap is also not a tap
    act(() => result.current.onPointerDown(pt()))
    act(() => result.current.onPointerUp())
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).toHaveBeenCalledTimes(1)
    act(() => result.current.onPointerUp())
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })

  it('keyboard activation (a click with no pointer sequence) fires onShortTap', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onClick?.(KEY))
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })

  it('returns no onClick when there is no onShortTap (hold-only callers keep theirs)', () => {
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn() }))
    expect('onClick' in result.current).toBe(false)
  })

  it('tolerates sub-threshold finger jitter — a steady hold still fires', () => {
    const onLongPress = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress }))
    act(() => result.current.onPointerDown(pt(0, 0)))
    act(() => result.current.onPointerMove(pt(3, 4)))
    act(() => {
      jest.advanceTimersByTime(450)
    })
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })
  it('a pointer click with no press on this element opens nothing', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).not.toHaveBeenCalled()
  })

  it('keyboard activation after a scroll took the press (pointercancel, no click) still opens', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onPointerDown(pt(0, 0)))
    act(() => result.current.onPointerMove(pt(0, 30)))
    act(() => result.current.onPointerCancel())
    act(() => result.current.onClick?.(TAP)) // a stray pointer click: the press is over
    expect(onShortTap).not.toHaveBeenCalled()
    act(() => result.current.onClick?.(KEY))
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })

  it('keyboard activation after a completed hold with no trailing click still opens', () => {
    const onShortTap = jest.fn()
    const onLongPress = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress, onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => {
      jest.advanceTimersByTime(600)
    })
    act(() => result.current.onPointerUp())
    act(() => result.current.onClick?.(KEY))
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })

  it('F7 pointercancel ends the press: a pointer click after it (no drag) does not open', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => result.current.onPointerCancel())
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).not.toHaveBeenCalled()
  })

  it('F7 a click ends the press: a second click with no new press does not open', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => result.current.onPointerUp())
    act(() => result.current.onClick?.(TAP))
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })

  // S104 fix round 3: no clock — the last press's token decides.
  it('T1d a real tap whose click comes 3 s after its pointerup (a stall) still opens', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => result.current.onPointerUp())
    act(() => {
      jest.advanceTimersByTime(3000)
    })
    act(() => result.current.onClick?.({ detail: 1, timeStamp: performance.now() + 3000 } as React.MouseEvent))
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })

  it('T1d a press on row A (no click) never lets a pointer click on row B open B; a normal tap on B then opens', () => {
    const tapA = jest.fn()
    const tapB = jest.fn()
    const a = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap: tapA }))
    const b = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap: tapB }))
    act(() => a.result.current.onPointerDown(pt()))
    act(() => a.result.current.onPointerUp())
    act(() => b.result.current.onClick?.(TAP))
    expect(tapB).not.toHaveBeenCalled()
    act(() => b.result.current.onPointerDown(pt()))
    act(() => b.result.current.onPointerUp())
    act(() => b.result.current.onClick?.(TAP))
    expect(tapB).toHaveBeenCalledTimes(1)
    expect(tapA).not.toHaveBeenCalled()
  })

  it('T-H2b any new finger-down ends the last press, even one the hook never sees: the stale click does not open; a keyboard click still opens', () => {
    const onShortTap = jest.fn()
    const { result } = renderHook(() => useLongPress({ onLongPress: jest.fn(), onShortTap }))
    act(() => result.current.onPointerDown(pt()))
    act(() => result.current.onPointerUp())
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    act(() => result.current.onClick?.(TAP))
    expect(onShortTap).not.toHaveBeenCalled()
    act(() => result.current.onClick?.(KEY))
    expect(onShortTap).toHaveBeenCalledTimes(1)
  })
})
