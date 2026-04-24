import { SynqedClient } from '@synqed-kk/client'
import { getTenantId } from '@/lib/staff'

/**
 * Creates a SynqedClient scoped to the current user's tenant.
 * Call this in server actions/routes — it reads the tenant ID from the
 * authenticated user's profile. Env vars are read lazily so that module
 * imports in build environments without runtime env don't crash.
 */
export async function getSynqedClient() {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing SYNQED_CORE_URL or SYNQED_CORE_API_KEY env vars')
  }
  const tenantId = await getTenantId()
  return new SynqedClient({ baseUrl, apiKey, tenantId })
}
