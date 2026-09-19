'use server'

import { SynqedError } from '@synqed-kk/client'
import { z } from 'zod'
import { getSynqedClient } from '@/lib/synqed/client'
import { DISPLAYED_COACHING_POLICY_VERSION, type CoachingConsentDecision, type CoachingConsentState, type ConsentResult } from '@/lib/coaching-consent/types'

// The existing cookie-scoped client forwards the verified human's access token.
// Core resolves that subject's own card. No shared-device staff selection or
// caller-supplied business/card ID has authority over consent.
export async function getCoachingConsent(): Promise<ConsentResult<CoachingConsentState>> {
  try {
    const client = await getSynqedClient()
    return { ok: true, data: await client.fetch<CoachingConsentState>('/coaching-consent/me', { cache: 'no-store' }) }
  } catch {
    return { ok: false, error: 'failed' }
  }
}

export async function decideCoachingConsent(input: {
  status: 'granted' | 'declined'; policy_version: string
}): Promise<ConsentResult<CoachingConsentDecision>> {
  const parsed = z.object({ status: z.enum(['granted', 'declined']), policy_version: z.string().min(1).max(200) }).strict().safeParse(input)
  if (!parsed.success) return { ok: false, error: 'failed' }
  if (parsed.data.status === 'granted' && parsed.data.policy_version !== DISPLAYED_COACHING_POLICY_VERSION)
    return { ok: false, error: 'policyChanged' }
  try {
    const client = await getSynqedClient()
    return { ok: true, data: await client.fetch<CoachingConsentDecision>('/coaching-consent/me', {
      method: 'POST', body: JSON.stringify(parsed.data), cache: 'no-store',
    }) }
  } catch (error) {
    return { ok: false, error: error instanceof SynqedError && error.status === 409 ? 'policyChanged' : 'failed' }
  }
}
