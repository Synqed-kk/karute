import { SynqedClient } from '@synqed-kk/client'
import { getTenantId } from '@/lib/staff'

const baseUrl = process.env.SYNQED_CORE_URL
const apiKey = process.env.SYNQED_API_KEY

if (!baseUrl || !apiKey) {
  throw new Error('Missing SYNQED_CORE_URL or SYNQED_API_KEY env vars')
}

/**
 * Creates a SynqedClient scoped to the current user's tenant.
 * Call this in server actions/routes — it reads the tenant ID
 * from the authenticated user's profile.
 */
export async function getSynqedClient() {
  const tenantId = await getTenantId()
  return new SynqedClient({ baseUrl: baseUrl!, apiKey: apiKey!, tenantId })
}
