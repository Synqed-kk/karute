'use client'

// ─────────────────────────────────────────────────────────────
// Coaching dev preview — state layer (localStorage scaffold)
// ─────────────────────────────────────────────────────────────
// Mirrors the coaching-consent state-layer pattern:
//   useSyncExternalStore + localStorage + cross-tab sync via
//   the 'storage' event.
//
// ENABLEMENT
//
// The dev preview is gated behind two signals — either flips
// it on for the current build:
//
//   1. process.env.NODE_ENV === 'development'
//      Auto-enables for anyone running `npm run dev`. Both
//      Liam and Anthony's local environments see the toggle.
//
//   2. process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW === 'true'
//      Opt-in env var for staging deploys where QA wants the
//      affordance without flipping NODE_ENV.
//
// Production builds (NODE_ENV='production' with the env var
// unset) NEVER render the toggle and NEVER honor an override
// — useEffectiveCoachingRole degrades to the real role.
//
// SECURITY POSTURE (repeat from types.ts for visibility)
//
// This is a CLIENT-SIDE RENDER OVERRIDE ONLY. It does not
// elevate API privileges. RLS continues to scope data to the
// caller's real session. A dev flipping to "owner" preview
// against a staff session sees the owner SHELL rendered, but
// the API still returns staff-scoped data.

import { useCallback, useSyncExternalStore } from 'react'

import type { CoachingRole, DevPreviewRoleOverride } from './types'

const STORAGE_KEY = 'synqed-karute-coaching-dev-preview-role'

const EMPTY: DevPreviewRoleOverride = null

// ─── Environment gate ────────────────────────────────────────

/** True when the current build should expose the dev-preview
 *  affordance. Inlined at build time — production deploys with
 *  no opt-in env var return false and tree-shake the toggle
 *  callsites out. */
export function isDevPreviewEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' ||
    process.env.NEXT_PUBLIC_ENABLE_COACHING_PREVIEW === 'true'
  )
}

// ─── localStorage-backed store ───────────────────────────────

const listeners = new Set<() => void>()
function notifyAll() {
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
let cachedParsed: DevPreviewRoleOverride = EMPTY

function read(): DevPreviewRoleOverride {
  if (typeof window === 'undefined') return EMPTY
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cachedRaw = null
    cachedParsed = EMPTY
    return EMPTY
  }
  if (raw === cachedRaw) return cachedParsed
  if (raw === 'owner' || raw === 'staff') {
    cachedRaw = raw
    cachedParsed = raw
    return raw
  }
  cachedRaw = null
  cachedParsed = EMPTY
  return EMPTY
}

function write(next: DevPreviewRoleOverride) {
  if (typeof window === 'undefined') return
  if (next === null) {
    window.localStorage.removeItem(STORAGE_KEY)
  } else {
    window.localStorage.setItem(STORAGE_KEY, next)
  }
  notifyAll()
}

// ─── Hooks ───────────────────────────────────────────────────

/** Returns the current override, or null when none is set.
 *  In production this always returns null (env gate). */
export function useDevPreviewRoleOverride(): DevPreviewRoleOverride {
  // The store works in dev or prod — we just always read it. The
  // env gate lives on `useEffectiveCoachingRole` and the toggle
  // component so prod call sites short-circuit before touching
  // localStorage.
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

export function useDevPreviewMutations() {
  const setOverride = useCallback((next: DevPreviewRoleOverride) => {
    write(next)
  }, [])
  const clear = useCallback(() => {
    write(EMPTY)
  }, [])
  return { setOverride, clear }
}

/** The role the UI should render against. Equals the real
 *  session role unless dev preview is enabled AND an override
 *  is set in localStorage. */
export function useEffectiveCoachingRole(realRole: CoachingRole): CoachingRole {
  const override = useDevPreviewRoleOverride()
  if (!isDevPreviewEnabled()) return realRole
  return override ?? realRole
}
