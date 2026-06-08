import { createClient } from '@/lib/supabase/server'
import crypto from 'crypto'

/**
 * Simple AI response cache using Supabase.
 * Caches by a hash of the input to avoid duplicating expensive AI calls.
 */

function hashKey(input: unknown): string {
  const str = JSON.stringify(input)
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 32)
}

export async function getCachedAI(prefix: string, input: unknown): Promise<unknown | null> {
  const key = `${prefix}:${hashKey(input)}`
  try {
    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from('ai_cache')
      .select('result')
      .eq('cache_key', key)
      .gt('expires_at', new Date().toISOString())
      .single()
    return data?.result ?? null
  } catch {
    // Cache is best-effort — a missing ai_cache table or a transient error must
    // never break the caller. Degrade to a cache miss (the caller recomputes).
    return null
  }
}

export async function setCachedAI(prefix: string, input: unknown, result: unknown, ttlDays = 7): Promise<void> {
  const key = `${prefix}:${hashKey(input)}`
  try {
    const supabase = await createClient()
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('ai_cache')
      .upsert({
        cache_key: key,
        result,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      }, { onConflict: 'cache_key' })
  } catch {
    // Best-effort write — never throw on a missing table / transient error.
  }
}
