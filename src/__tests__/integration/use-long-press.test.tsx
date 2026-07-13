/**
 * @jest-environment jsdom
 *
 * Unit coverage for useLongPress (PR #96/replay/22): hold-past-threshold fires
 * onLongPress; early release fires onShortTap; leave/cancel fires neither.
 * Movement tolerance (booking-page drag bug): pointer travel past 10px is a
 * scroll attempt, not a tap or a hold — fires neither.
 */
import { renderHook, act } from '@testing-library/react'
import { useLongPress } from '@/hooks/use-long-press'

// The hook only reads clientX/clientY off the pointer event.
const pt = (x = 0, y = 0) => ({ clientX: x, clientY: y }) as React.PointerEvent

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
    expect(onShortTap).not.toHaveBeenCalled()
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
})
