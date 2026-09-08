'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCoachingConsent, decideCoachingConsent } from '@/actions/coaching-consent'
import { createClient } from '@/lib/supabase/client'
import { DISPLAYED_COACHING_POLICY_VERSION, type CoachingConsentRecord } from './types'

const EMPTY: CoachingConsentRecord = { status: 'unset', decidedAt: null, policyVersion: null }

/** Per-mounted-view server state. Old localStorage grants are never trusted or imported. */
export function useCoachingConsent() {
  const [consent, setConsent] = useState(EMPTY)
  const [policyVersion, setPolicyVersion] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [identityRevision, setIdentityRevision] = useState(0)
  const [error, setError] = useState<'loadFailed' | 'saveFailed' | 'policyChanged' | 'policyUnavailable' | null>(null)
  const epoch = useRef(0)
  const writing = useRef(false)

  const reload = useCallback(async () => {
    if (writing.current) return
    const request = ++epoch.current
    setLoading(true)
    try {
      const result = await getCoachingConsent()
      if (request !== epoch.current) return
      if (!result.ok) throw new Error('Consent unavailable')
      setConsent({ status: result.data.status, decidedAt: result.data.decision?.decided_at ?? null,
        policyVersion: result.data.decision?.policy_version ?? null })
      setPolicyVersion(result.data.current_policy_version)
      setError(null)
      return true
    } catch {
      if (request !== epoch.current) return
      setConsent(EMPTY)
      setPolicyVersion(null)
      setError('loadFailed')
      return false
    } finally {
      if (request === epoch.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const requests = epoch
    void reload()
    const onFocus = () => { void reload() }
    window.addEventListener('focus', onFocus)
    let subject: string | null | undefined
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const nextSubject = session?.user.id ?? null
      if (subject === nextSubject) return
      subject = nextSubject
      setIdentityRevision(value => value + 1)
      // Drop previous account state and ignore every response started for it.
      ++epoch.current
      writing.current = false
      setSaving(false)
      setConsent(EMPTY)
      setPolicyVersion(null)
      void reload()
    })
    return () => {
      ++requests.current
      subscription.unsubscribe()
      window.removeEventListener('focus', onFocus)
    }
  }, [reload])

  const decide = useCallback(async (status: 'granted' | 'declined'): Promise<boolean> => {
    if (writing.current || loading || !policyVersion) return false
    if (status === 'granted' && policyVersion !== DISPLAYED_COACHING_POLICY_VERSION) {
      setError('policyUnavailable')
      return false
    }
    writing.current = true
    setSaving(true)
    setError(null)
    const request = ++epoch.current
    try {
      const result = await decideCoachingConsent({ status, policy_version: policyVersion })
      if (request !== epoch.current) return false
      if (!result.ok) {
        if (result.error === 'policyChanged') {
          writing.current = false
          setSaving(false)
          setPolicyVersion(null)
          const refreshed = await reload()
          if (refreshed && epoch.current === request + 1) setError('policyChanged')
        } else setError('saveFailed')
        return false
      }
      setConsent({ status: result.data.status, decidedAt: result.data.decided_at, policyVersion: result.data.policy_version })
      setPolicyVersion(result.data.policy_version)
      return true
    } catch {
      if (request === epoch.current) setError('saveFailed')
      return false
    } finally {
      if (request === epoch.current) {
        writing.current = false
        setSaving(false)
      }
    }
  }, [loading, policyVersion, reload])

  return { ...consent, loading, saving, error, reload, decide, identityRevision,
    currentPolicyVersion: policyVersion, canGrant: policyVersion === DISPLAYED_COACHING_POLICY_VERSION }
}
