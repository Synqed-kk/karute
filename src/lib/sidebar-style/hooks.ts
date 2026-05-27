'use client'

// ─────────────────────────────────────────────────────────────
// Sidebar style — localStorage scaffold
// ─────────────────────────────────────────────────────────────
// Lets the owner pick a light vs dark sidebar appearance from
// Settings → 表示テーマ. Visual-only today — the actual sidebar
// component (`src/components/layout/sidebar.tsx`) still renders
// in its single tone. When Anthony wires the real sidebar style
// switch he reads the same hook and conditionally applies the
// dark variant.
//
// Same useSyncExternalStore + localStorage pattern as
// coaching-consent, dev-preview, subscription, intake-form-
// customizations, scheduled-deletions.

import { useCallback, useSyncExternalStore } from 'react'

export type SidebarStyle = 'light' | 'dark'

const STORAGE_KEY = 'synqed-karute-sidebar-style'
const DEFAULT: SidebarStyle = 'light'

const listeners = new Set<() => void>()
function notify() {
  for (const fn of listeners) fn()
}
function subscribe(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

let cachedRaw: string | null = null
let cachedParsed: SidebarStyle = DEFAULT

function read(): SidebarStyle {
  if (typeof window === 'undefined') return DEFAULT
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cachedRaw = null
    cachedParsed = DEFAULT
    return DEFAULT
  }
  if (raw === cachedRaw) return cachedParsed
  if (raw === 'light' || raw === 'dark') {
    cachedRaw = raw
    cachedParsed = raw
    return raw
  }
  cachedRaw = null
  cachedParsed = DEFAULT
  return DEFAULT
}

function write(next: SidebarStyle) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, next)
  notify()
}

export function useSidebarStyle(): SidebarStyle {
  return useSyncExternalStore(subscribe, read, () => DEFAULT)
}

export function useSidebarStyleMutations() {
  const setSidebarStyle = useCallback((next: SidebarStyle) => {
    write(next)
  }, [])
  return { setSidebarStyle }
}
