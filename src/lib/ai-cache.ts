import { SynqedClient } from '@synqed-kk/client'
import crypto from 'crypto'

/**
 * Simple AI response cache, backed by synqed-core's global `ai_cache`.
 * Caches by a hash of the input to avoid duplicating expensive AI calls.
 *
 * The cache is global infra (not per-business), so it uses a no-business client
 * against core's API-key-gated, business-optional /v1/ai-cache routes. Every op
 * is best-effort — a miss/error must never break the caller.
 */

function hashKey(input: unknown): string {
  const str = JSON.stringify(input)
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32)
}

/** A no-business SynqedClient for the global cache (ai-cache routes don't need
 *  x-business-id). Returns null if core env isn't configured → caller degrades. */
function cacheClient(): SynqedClient | null {
  const baseUrl = process.env.SYNQED_CORE_URL
  const apiKey = process.env.SYNQED_CORE_API_KEY
  if (!baseUrl || !apiKey) return null
  return new SynqedClient({ baseUrl, apiKey, businessId: '' })
}

export async function getCachedAI(prefix: string, input: unknown): Promise<unknown | null> {
  const key = `${prefix}:${hashKey(input)}`
  try {
    const client = cacheClient()
    if (!client) return null
    return await client.aiCache.get(key)
  } catch {
    // Cache is best-effort — degrade to a miss (the caller recomputes).
    return null
  }
}

export async function setCachedAI(prefix: string, input: unknown, result: unknown, ttlDays = 7): Promise<void> {
  const key = `${prefix}:${hashKey(input)}`
  try {
    const client = cacheClient()
    if (!client) return
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
    await client.aiCache.upsert({ cache_key: key, result, expires_at: expiresAt })
  } catch {
    // Best-effort write — never throw on a transient error.
  }
}

/** Delete expired cache entries (cron maintenance). Returns the count deleted. */
export async function cleanupExpiredAiCache(): Promise<number> {
  try {
    const client = cacheClient()
    if (!client) return 0
    const { deleted } = await client.aiCache.cleanup()
    return deleted
  } catch {
    return 0
  }
}
