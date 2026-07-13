/**
 * @jest-environment jsdom
 *
 * Gating logic only for ColdStartOverlay (coldstart-attribution packet):
 * flag-absent must do zero measurement work, and the query param must
 * promote to a persistent localStorage flag. Does not exercise the metrics
 * pipeline itself — jsdom ships no real Performance Timeline / paint entries
 * / requestAnimationFrame, and re-implementing them here would be test
 * theater for numbers this suite can't actually produce.
 */
import { render, cleanup } from '@testing-library/react'
import { ColdStartOverlay } from '@/components/shell/ColdStartOverlay'

const originalRaf = window.requestAnimationFrame
const originalCaf = window.cancelAnimationFrame

beforeEach(() => {
  window.localStorage.clear()
  window.history.pushState({}, '', '/ja')
  // jsdom has no requestAnimationFrame; stub a no-op so the effect can run
  // past the gate check without throwing. The callback deliberately never
  // fires — the metrics pipeline it would call (performance.mark / entry
  // reads) isn't under test here, only the gate.
  window.requestAnimationFrame = jest.fn(() => 0)
  window.cancelAnimationFrame = jest.fn()
})

afterEach(() => {
  cleanup()
  window.requestAnimationFrame = originalRaf
  window.cancelAnimationFrame = originalCaf
})

test('flag absent: renders nothing and does no measurement work', () => {
  const { container } = render(<ColdStartOverlay />)
  expect(container).toBeEmptyDOMElement()
  expect(window.requestAnimationFrame).not.toHaveBeenCalled()
})

test('?perfdebug=1: promotes to a persistent localStorage flag and enters the measurement path', () => {
  window.history.pushState({}, '', '/ja?perfdebug=1')
  render(<ColdStartOverlay />)
  expect(window.localStorage.getItem('karutePerfdebug')).toBe('1')
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)
})

test('localStorage flag alone (no query param): enters the measurement path', () => {
  window.localStorage.setItem('karutePerfdebug', '1')
  render(<ColdStartOverlay />)
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)
})
