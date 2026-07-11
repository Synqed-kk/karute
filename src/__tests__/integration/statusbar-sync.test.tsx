/** @jest-environment jsdom */
// Adversarial verification of commit 62d4254 — StatusBarSync.
// Exercises the REAL component + real next-themes 0.4.6 + real React 19.

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useTheme } from 'next-themes'
import { ThemeProvider } from '@/components/providers/theme-provider'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

// jsdom has no matchMedia; next-themes calls it unconditionally in its
// provider effect. Minimal stub (next-themes uses legacy add/removeListener).
window.matchMedia = ((query: string) => ({
  matches: false, // "OS light" — irrelevant here, enableSystem is false
  media: query,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  onchange: null,
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

let setThemeRef: ((t: string) => void) | null = null
function GrabSetTheme() {
  const { setTheme } = useTheme()
  // eslint-disable-next-line react-hooks/immutability -- test harness grabs the context setter; not app code
  setThemeRef = setTheme
  return null
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  localStorage.clear()
  document.documentElement.className = ''
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  setThemeRef = null
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  delete (window as Record<string, unknown> & Window).Capacitor
})

test('shell + stored dark theme: cold mount fires setStyle DARK exactly once', async () => {
  localStorage.setItem('theme', 'dark')
  const setStyle = jest.fn().mockResolvedValue(undefined)
  ;(window as Record<string, unknown> & Window).Capacitor = {
    Plugins: { StatusBar: { setStyle } },
  }

  await act(async () => {
    root.render(
      <ThemeProvider>
        <GrabSetTheme />
        <p>page</p>
      </ThemeProvider>
    )
  })

  expect(setStyle).toHaveBeenCalledTimes(1)
  expect(setStyle).toHaveBeenCalledWith({ style: 'DARK' })
})

test('shell: theme toggle dark->light re-fires with LIGHT', async () => {
  localStorage.setItem('theme', 'dark')
  const setStyle = jest.fn().mockResolvedValue(undefined)
  ;(window as Record<string, unknown> & Window).Capacitor = {
    Plugins: { StatusBar: { setStyle } },
  }

  await act(async () => {
    root.render(
      <ThemeProvider>
        <GrabSetTheme />
      </ThemeProvider>
    )
  })
  await act(async () => {
    setThemeRef!('light')
  })

  expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' })
  expect(setStyle).toHaveBeenCalledTimes(2)
})

test('shell + no stored theme: defaults to light -> LIGHT', async () => {
  const setStyle = jest.fn().mockResolvedValue(undefined)
  ;(window as Record<string, unknown> & Window).Capacitor = {
    Plugins: { StatusBar: { setStyle } },
  }

  await act(async () => {
    root.render(
      <ThemeProvider>
        <p>page</p>
      </ThemeProvider>
    )
  })

  expect(setStyle).toHaveBeenCalledWith({ style: 'LIGHT' })
})

test('plain browser (no Capacitor): renders children, throws nothing, adds no globals', async () => {
  localStorage.setItem('theme', 'dark')

  await act(async () => {
    root.render(
      <ThemeProvider>
        <p>page</p>
      </ThemeProvider>
    )
  })

  expect(container.querySelector('p')?.textContent).toBe('page')
  expect('Capacitor' in window).toBe(false)
})

test('shell bridge present but StatusBar plugin missing: no throw', async () => {
  localStorage.setItem('theme', 'dark')
  ;(window as Record<string, unknown> & Window).Capacitor = {
    Plugins: { SplashScreen: { hide: () => Promise.resolve() } },
  }

  await act(async () => {
    root.render(
      <ThemeProvider>
        <p>page</p>
      </ThemeProvider>
    )
  })

  expect(container.querySelector('p')?.textContent).toBe('page')
})

test('children do NOT re-render when theme changes (only StatusBarSync consumes context)', async () => {
  localStorage.setItem('theme', 'dark')
  const setStyle = jest.fn().mockResolvedValue(undefined)
  ;(window as Record<string, unknown> & Window).Capacitor = {
    Plugins: { StatusBar: { setStyle } },
  }

  let childRenders = 0
  function CountingChild() {
    // eslint-disable-next-line react-hooks/immutability -- render counter is the point of this test
    childRenders++
    return <p>child</p>
  }

  await act(async () => {
    root.render(
      <ThemeProvider>
        <GrabSetTheme />
        <CountingChild />
      </ThemeProvider>
    )
  })
  const rendersAfterMount = childRenders

  await act(async () => {
    setThemeRef!('light')
  })

  expect(setStyle).toHaveBeenLastCalledWith({ style: 'LIGHT' })
  expect(childRenders).toBe(rendersAfterMount)
})
