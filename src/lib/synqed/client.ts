import 'server-only'
import { SynqedClient } from '@synqed/client'

let cached: SynqedClient | null = null

/**
 * Server-side synqed-core client. Uses the service API key.
 * Pass the tenant/org id per call — this lets us use one client instance
 * across orgs when running server-side jobs or cross-tenant operations.
 */
export function getSynqedClient(tenantId: string): SynqedClient {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl) throw new Error('SYNQED_CORE_URL is not set')
  if (!apiKey) throw new Error('SYNQED_CORE_API_KEY is not set')

  // Simple cache keyed by tenant. SynqedClient is cheap to construct,
  // but avoids repeated env lookups on hot paths.
  if (cached && (cached as unknown as { _tenantId: string })._tenantId === tenantId) {
    return cached
  }
  cached = new SynqedClient({ baseUrl, apiKey, tenantId })
  ;(cached as unknown as { _tenantId: string })._tenantId = tenantId
  return cached
}
