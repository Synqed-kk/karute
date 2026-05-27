/**
 * @jest-environment jsdom
 *
 * Unit coverage for the sidebar-style preference hook added in PR #83
 * (replay/08). localStorage-backed light/dark preference.
 */
import { renderHook, act } from '@testing-library/react'
import {
  useSidebarStyle,
  useSidebarStyleMutations,
} from '@/lib/sidebar-style/hooks'

const STORAGE_KEY = 'synqed-karute-sidebar-style'

function setup() {
  return renderHook(() => ({
    style: useSidebarStyle(),
    ...useSidebarStyleMutations(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useSidebarStyle', () => {
  it('defaults to "light" when nothing is stored', () => {
    const { result } = setup()
    expect(result.current.style).toBe('light')
  })

  it('reads a stored "dark" preference', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')
    const { result } = setup()
    expect(result.current.style).toBe('dark')
  })

  it('falls back to "light" for an invalid stored value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'rainbow')
    const { result } = setup()
    expect(result.current.style).toBe('light')
  })
})

describe('useSidebarStyleMutations', () => {
  it('setSidebarStyle("dark") updates the hook and persists', () => {
    const { result } = setup()
    act(() => result.current.setSidebarStyle('dark'))
    expect(result.current.style).toBe('dark')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark')
  })

  it('round-trips back to "light"', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark')
    const { result } = setup()
    act(() => result.current.setSidebarStyle('light'))
    expect(result.current.style).toBe('light')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light')
  })
})
