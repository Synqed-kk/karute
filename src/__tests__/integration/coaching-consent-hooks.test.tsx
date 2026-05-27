/**
 * @jest-environment jsdom
 *
 * Unit coverage for the coaching-consent state layer added in PR #95
 * (replay/21 — settings shell + sections). Exercises the localStorage-backed
 * useSyncExternalStore read hook and every mutation (grant / decline / reset).
 */
import { renderHook, act } from '@testing-library/react'
import {
  useCoachingConsent,
  useCoachingConsentMutations,
} from '@/lib/coaching-consent/hooks'
import type { CoachingConsentRecord } from '@/lib/coaching-consent/types'

const STORAGE_KEY = 'synqed-karute-coaching-consent'
const CURRENT_POLICY_VERSION = 'v1.0-2026-05'

function seed(record: CoachingConsentRecord) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
}

function setup() {
  return renderHook(() => ({
    consent: useCoachingConsent(),
    ...useCoachingConsentMutations(),
  }))
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('useCoachingConsent', () => {
  it('defaults to the unset EMPTY record when nothing is stored', () => {
    const { result } = setup()
    expect(result.current.consent).toEqual({
      status: 'unset',
      decidedAt: null,
      policyVersion: null,
    })
  })

  it('reads a seeded granted record', () => {
    seed({
      status: 'granted',
      decidedAt: '2026-05-01T00:00:00Z',
      policyVersion: CURRENT_POLICY_VERSION,
    })
    const { result } = setup()
    expect(result.current.consent.status).toBe('granted')
    expect(result.current.consent.decidedAt).toBe('2026-05-01T00:00:00Z')
    expect(result.current.consent.policyVersion).toBe(CURRENT_POLICY_VERSION)
  })

  it('falls back to the unset EMPTY record on malformed JSON', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    const { result } = setup()
    expect(result.current.consent).toEqual({
      status: 'unset',
      decidedAt: null,
      policyVersion: null,
    })
  })
})

describe('useCoachingConsentMutations', () => {
  it('grant() persists a granted record with the current policy version', () => {
    const { result } = setup()
    act(() => result.current.grant())
    expect(result.current.consent.status).toBe('granted')
    expect(result.current.consent.policyVersion).toBe(CURRENT_POLICY_VERSION)
    expect(result.current.consent.decidedAt).not.toBeNull()

    const stored = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY)!,
    ) as CoachingConsentRecord
    expect(stored.status).toBe('granted')
    expect(stored.policyVersion).toBe(CURRENT_POLICY_VERSION)
    // decidedAt is an ISO timestamp.
    expect(() => new Date(stored.decidedAt!).toISOString()).not.toThrow()
  })

  it('decline() persists a declined record reactively', () => {
    const { result } = setup()
    act(() => result.current.decline())
    expect(result.current.consent.status).toBe('declined')
    expect(result.current.consent.policyVersion).toBe(CURRENT_POLICY_VERSION)
    expect(result.current.consent.decidedAt).not.toBeNull()
  })

  it('reset() returns to the unset EMPTY record', () => {
    seed({
      status: 'granted',
      decidedAt: '2026-05-01T00:00:00Z',
      policyVersion: CURRENT_POLICY_VERSION,
    })
    const { result } = setup()
    expect(result.current.consent.status).toBe('granted')
    act(() => result.current.reset())
    expect(result.current.consent).toEqual({
      status: 'unset',
      decidedAt: null,
      policyVersion: null,
    })
    // reset writes the EMPTY record (does not removeItem).
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
      JSON.stringify({ status: 'unset', decidedAt: null, policyVersion: null }),
    )
  })

  it('decline() then grant() flips the persisted decision', () => {
    const { result } = setup()
    act(() => result.current.decline())
    expect(result.current.consent.status).toBe('declined')
    act(() => result.current.grant())
    expect(result.current.consent.status).toBe('granted')
  })
})
