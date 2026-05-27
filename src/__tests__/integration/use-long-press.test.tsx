/**
 * @jest-environment jsdom
 *
 * Unit coverage for useLongPress (PR #96/replay/22): hold-past-threshold fires
 * onLongPress; early release fires onShortTap; leave/cancel fires neither.
 */
import { renderHook, act } from '@testing-library/react'
import { useLongPress } from '@/hooks/use-long-press'

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
    act(() => result.current.onPointerDown())
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
    act(() => result.current.onPointerDown())
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
    act(() => result.current.onPointerDown())
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
    act(() => result.current.onPointerDown())
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
    act(() => result.current.onPointerDown())
    act(() => result.current.onPointerUp())
    expect(onLongPress).not.toHaveBeenCalled()
  })
})
