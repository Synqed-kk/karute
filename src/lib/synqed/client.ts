import { SynqedClient } from '@synqed-kk/client'
import { getBusinessId } from '@/lib/staff'

/**
 * Creates a SynqedClient for an EXPLICIT business id. This is the tenancy seam:
 * the facade (Bearer path) passes the business resolved from the verified token,
 * NOT a cookie — so a mobile request is scoped to its own tenant deterministically.
 * Env vars are read lazily so module imports in build envs without runtime env
 * don't crash.
 */
export function newSynqedClient(businessId: string) {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
  }
  return new SynqedClient({ baseUrl, apiKey, businessId })
}

/**
 * Creates a SynqedClient scoped to the current user's business.
 * Call this in server actions/routes — it reads the business ID from the
 * authenticated user's profile (cookie path).
 */
export async function getSynqedClient() {
  return newSynqedClient(await getBusinessId())
}
