'use client'

// ─────────────────────────────────────────────────────────────
// Coaching consent — state layer (localStorage scaffold)
// ─────────────────────────────────────────────────────────────
// Lifted from spike consent-status pattern. Karute version is a
// SCAFFOLD — useCoachingConsent stores grant/decline in
// localStorage so the dialog UX works end-to-end during dev.
// Anthony's Supabase swap is documented inline.
//
// PROD SWAP (ANTHONY)
// -------------------
// Consent is append-only: every grant/decline INSERTs a row in
// coaching_consent rather than UPDATEing the existing one.
// That preserves the audit trail (when did staff change their
// mind? which policy version did they agree to?).
//
//   create table coaching_consent (
//     id uuid pk default gen_random_uuid(),
//     staff_id uuid not null references staff(id),
//     business_id uuid not null references businesses(id),
//     status text not null check (status in ('granted', 'declined')),
//     policy_version text not null,
//     created_at timestamptz default now() not null
//   );
//
//   create policy "staff inserts only own consent rows"
//     on coaching_consent for insert with check (
//       staff_id = (select id from staff where user_id = auth.uid())
//     );
//
//   create policy "staff reads own consent log"
//     on coaching_consent for select using (
//       staff_id = (select id from staff where user_id = auth.uid())
//     );
//
//   create policy "owner reads team consent status (rollup view only)"
//     -- Owners NEVER see the raw consent_log rows. They read a
//     -- Layer-2 view (coaching_consent_rollup) that exposes:
//     --   staff_id, granted boolean, given_at timestamptz,
//     --   policy_version text
//     -- but not the historical decline rows or any flip-flop noise.
//
// Current useCoachingConsent reads the MOST RECENT decision from
// the log; the schema flips of `status` over time are folded into
// a single status string at read time. Frontend never sees the
// audit history.

import { useCallback, useSyncExternalStore } from 'react'

import type { CoachingConsentRecord } from './types'

const STORAGE_KEY = 'synqed-karute-coaching-consent'

const EMPTY: CoachingConsentRecord = {
  status: 'unset',
  decidedAt: null,
  policyVersion: null,
}

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
let cachedParsed: CoachingConsentRecord = EMPTY

function read(): CoachingConsentRecord {
  if (typeof window === 'undefined') return EMPTY
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    cachedRaw = null
    cachedParsed = EMPTY
    return EMPTY
  }
  if (raw === cachedRaw) return cachedParsed
  try {
    const parsed = JSON.parse(raw) as CoachingConsentRecord
    cachedRaw = raw
    cachedParsed = parsed
    return parsed
  } catch {
    cachedRaw = null
    cachedParsed = EMPTY
    return EMPTY
  }
}

function write(next: CoachingConsentRecord) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  notifyAll()
}

const CURRENT_POLICY_VERSION = 'v1.0-2026-05'

export function useCoachingConsent(): CoachingConsentRecord {
  return useSyncExternalStore(subscribe, read, () => EMPTY)
}

export function useCoachingConsentMutations() {
  const grant = useCallback(() => {
    write({
      status: 'granted',
      decidedAt: new Date().toISOString(),
      policyVersion: CURRENT_POLICY_VERSION,
    })
  }, [])
  const decline = useCallback(() => {
    write({
      status: 'declined',
      decidedAt: new Date().toISOString(),
      policyVersion: CURRENT_POLICY_VERSION,
    })
  }, [])
  /** Reset the consent state — useful for re-prompting after a
   *  policy update. Backend equivalent: insert a new row with
   *  status='declined' to invalidate the previous grant, then
   *  the frontend re-prompts. */
  const reset = useCallback(() => {
    write(EMPTY)
  }, [])
  return { grant, decline, reset }
}
